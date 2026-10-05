import type { CommandRemote, CoordinationGuard, Coordinator, FilesManifest, FilePlan, Head, Scope, Snapshot, StateStore, FileAction } from './contracts';
import { assertSync, SyncError } from './errors';
import { bindingToken, assertBinding, planFileSync, selected } from './planner';
import { encodeManifest, sha256, canonical } from './encoding';
import { OperationManager } from './operations';
import { resolveFileConflicts } from './resolve';
import { discoverDatasets, type DiscoveryRemote } from './discovery';
import { mergeText } from './text-merge';
import { scopedStore } from './coordination';

export interface FileRemote extends CommandRemote, DiscoveryRemote {
    project(projectId: string): Promise<{ lifecycleRevision: string; state: string }>;
    head(projectId: string, datasetId: string): Promise<Head>;
    pin(projectId: string, manifestHash: string, requestKey: string): Promise<string>;
    releasePin(projectId: string, pinId: string): Promise<void>;
    download(projectId: string, hash: string): Promise<Uint8Array>;
    upload(projectId: string, bytes: Uint8Array): Promise<string>;
    ack(projectId: string, replicaId: string, cursor: string, scopeRevision: string): Promise<void>;
    check(projectId: string, hashes: string[]): Promise<{ ready: string[] }>;
}
export interface FileLocal {
    scoped?(guard: CoordinationGuard): FileLocal;
    capture(): Promise<{ scan: Snapshot; handle: unknown }>;
    cache(bytes: Uint8Array): Promise<string>;
    object(hash: string): Promise<Uint8Array>;
    save(plan: StoredFilePlan): Promise<void>;
    load(id: string): Promise<StoredFilePlan | undefined>;
    apply(token: string, handle: unknown, actions: FileAction[], id: string): Promise<void>;
}
export interface StoredFilePlan {
    id: string; bindingToken: string; scopeToken: string; changesCursor: string; head: Head; lifecycleRevision: string;
    plan: FilePlan; handle: unknown; phase: 'prepared' | 'publishing' | 'published' | 'applied' | 'rejected' | 'abandoned';
    commandOperationId?: string;
}
/** Transport and local application are separate recoverable boundaries. */
export class FileSync {
    private readonly operations: OperationManager;
    constructor(readonly store: StateStore, private readonly local: FileLocal, private readonly remote: FileRemote,
        private readonly coordinator: Coordinator, private readonly newId: () => string, private readonly scope: Scope) {
        this.operations = new OperationManager(store, remote, coordinator, newId);
        this.scope = structuredClone(scope);
    }
    private exclusive<T>(key: string, action: (sync: FileSync) => Promise<T>): Promise<T> {
        return this.coordinator.exclusive(key, guard => {
            if (!guard) return action(this);
            assertSync(this.local.scoped, 'COORDINATION_FENCING_UNAVAILABLE');
            const sync = new FileSync(scopedStore(this.store, guard), this.local.scoped(guard),
                this.remote, this.coordinator, this.newId, this.scope);
            return action(sync);
        });
    }
    async preview(): Promise<StoredFilePlan> {
        const binding = (await this.store.read()).binding;
        return this.exclusive(binding.bindingId, async sync => {
            await sync.operations.recover(); await sync.recoverApply(); await sync.acknowledge(); return sync.capturePreview();
        });
    }
    private async capturePreview(): Promise<StoredFilePlan> {
        const state = await this.store.read(); assertSync(state.binding.state === 'active', 'BINDING_INACTIVE');
        const b = state.binding, project = await this.remote.project(b.projectId);
        assertSync(project.state === 'active', 'PROJECT_DELETED');
        const discovery = await discoverDatasets(this.store, this.remote);
        const dataset = discovery.datasets.find(d => d.datasetId === b.datasetId);
        assertSync(dataset?.state === 'active' && dataset.kind === 'files', 'DATASET_INCOMPATIBLE');
        const head = dataset.head;
        const pin = await this.remote.pin(b.projectId, head.manifestHash, this.newId());
        try {
            const cloud = await this.manifest(b.projectId, head.manifestHash);
            for (const entry of cloud.entries) if (entry.kind === 'file' && selected(entry.path, this.scope)) await this.cacheRemote(b.projectId, entry.hash);
            const capture = await this.local.capture();
            const plan = planFileSync(state.baseline, capture.scan, cloud, this.scope, b.direction);
            const stored: StoredFilePlan = { id: this.newId(), bindingToken: bindingToken(b), scopeToken: canonical(this.scope), changesCursor: discovery.cursor, head,
                lifecycleRevision: project.lifecycleRevision, plan, handle: capture.handle, phase: 'prepared' };
            await this.local.save(stored); return stored;
        } finally { await this.remote.releasePin(b.projectId, pin).catch(() => {}); }
    }
    async reconcileExpired(): Promise<StoredFilePlan> {
        const b = (await this.store.read()).binding;
        return this.exclusive(b.bindingId, async sync => {
            try { await sync.operations.recover(); }
            catch (error) { if (!(error instanceof SyncError) || error.code !== 'RECONCILIATION_REQUIRED') throw error; }
            const state = await sync.store.read(); assertSync(state.pending?.terminalExpired, 'RECONCILIATION_REQUIRED');
            const preview = await sync.capturePreview();
            if (state.activePlanId) {
                const old = await sync.local.load(state.activePlanId);
                if (old) { old.phase = 'abandoned'; await sync.local.save(old); }
            }
            await sync.operations.acknowledgeExpiredReconciliation();
            await sync.store.update(s => ({ ...s, activePlanId: undefined })); return preview;
        });
    }
    async resolve(id: string, decisions: Record<string, 'local' | 'remote'>): Promise<StoredFilePlan> {
        const b = (await this.store.read()).binding;
        return this.exclusive(b.bindingId, async sync => {
            const stored = await sync.local.load(id); assertSync(stored?.phase === 'prepared', 'PLAN_INACTIVE');
            const state = await sync.store.read(); assertBinding(stored.bindingToken, state.binding);
            assertSync(stored.scopeToken === canonical(sync.scope), 'PLAN_SCOPE_CHANGED');
            const resolved = { ...stored, id: sync.newId(), plan: resolveFileConflicts(stored.plan, decisions, state.binding.direction) };
            await sync.local.save(resolved); return resolved;
        });
    }
    async execute(id: string): Promise<FilePlan> {
        const binding = (await this.store.read()).binding;
        return this.exclusive(binding.bindingId, sync => sync.executeUnlocked(id));
    }
    private async executeUnlocked(id: string): Promise<FilePlan> {
        const stored = await this.local.load(id); assertSync(stored, 'PLAN_NOT_FOUND');
        const state = await this.store.read(); assertBinding(stored.bindingToken, state.binding);
        assertSync(stored.scopeToken === canonical(this.scope), 'PLAN_SCOPE_CHANGED');
        assertSync(state.binding.state === 'active', 'BINDING_INACTIVE');
        if (stored.phase === 'applied') return stored.plan;
        assertSync(!['rejected', 'abandoned'].includes(stored.phase), 'PLAN_INACTIVE');
        await this.store.update(s => {
            assertSync(!s.activePlanId || s.activePlanId === id, 'LOCAL_APPLY_PENDING');
            return { ...s, activePlanId: id };
        });
        try {
            if (stored.phase === 'publishing') await this.confirmPublication(stored);
            if (stored.phase === 'prepared') await this.publish(stored);
        } catch (error) { await this.rejectPlanIfSafe(stored); throw error; }
        await this.local.apply(stored.bindingToken, stored.handle, stored.plan.actions, id);
        stored.phase = 'applied'; await this.local.save(stored);
        await this.store.update(s => ({ ...s, activePlanId: undefined, ackPending: stored.plan.conflicts.length ? s.ackPending
            : { cursor: stored.changesCursor, scopeRevision: s.binding.scopeRevision } }));
        await this.acknowledge();
        const ackError = (await this.store.read()).ackError;
        if (ackError) { stored.plan.warnings = [ackError.code]; await this.local.save(stored); }
        return stored.plan;
    }
    async recover(): Promise<void> {
        const binding = (await this.store.read()).binding;
        await this.exclusive(binding.bindingId, async sync => {
            await sync.operations.recover();
            if ((await sync.store.read()).binding.state === 'active') await sync.recoverApply();
        });
    }
    private async recoverApply(): Promise<void> {
        const state = await this.store.read();
        if (state.activePlanId) await this.executeUnlocked(state.activePlanId);
    }
    async cancel(): Promise<void> {
        const binding = (await this.store.read()).binding;
        await this.exclusive(binding.bindingId, async sync => {
            await sync.operations.cancel();
            const state = await sync.store.read();
            if (state.activePlanId) {
                const stored = await sync.local.load(state.activePlanId);
                if (stored) { stored.phase = 'abandoned'; await sync.local.save(stored); }
                await sync.store.update(s => ({ ...s, activePlanId: undefined }));
            }
        });
    }
    private async rejectPlanIfSafe(stored: StoredFilePlan): Promise<void> {
        const state = await this.store.read();
        const op = state.history.find(p => p.command.body.operationId === stored.commandOperationId);
        if (state.pending || (stored.phase !== 'prepared' && op?.receipt?.outcome !== 'not-committed')) return;
        stored.phase = 'rejected'; await this.local.save(stored);
        await this.store.update(s => ({ ...s, activePlanId: undefined }));
    }
    private async manifest(project: string, hash: string): Promise<FilesManifest> {
        const bytes = await this.remote.download(project, hash);
        const m = JSON.parse(new TextDecoder().decode(bytes)) as FilesManifest;
        assertSync(canonical(JSON.parse(new TextDecoder().decode(encodeManifest(m)))) === new TextDecoder().decode(bytes), 'INVALID_MANIFEST');
        return m;
    }
    private async cacheRemote(project: string, hash: string): Promise<void> {
        try { await this.local.object(hash); return; }
        catch (error) { if (!(error instanceof SyncError) || error.code !== 'LOCAL_OBJECT_MISSING') throw error; }
        assertSync(await this.local.cache(await this.remote.download(project, hash)) === hash, 'OBJECT_HASH_MISMATCH');
    }
    private async publish(stored: StoredFilePlan): Promise<void> {
        const state = await this.store.read(), b = state.binding;
        const project = await this.remote.project(b.projectId);
        assertSync(project.state === 'active' && project.lifecycleRevision === stored.lifecycleRevision, 'PLAN_PROJECT_CHANGED');
        const current = await this.remote.head(b.projectId, b.datasetId);
        assertSync(current.generation === stored.head.generation && current.manifestHash === stored.head.manifestHash, 'PLAN_CLOUD_CHANGED');
        if (!stored.plan.actions.some(a => a.side === 'upload' || a.side === 'merge')) { stored.phase = 'published'; await this.local.save(stored); return; }
        await this.uploadMissing(b.projectId, stored.plan);
        const next = encodeManifest(stored.plan.manifest), hash = await this.remote.upload(b.projectId, next);
        assertSync(hash === await sha256(next));
        stored.commandOperationId = this.newId(); stored.phase = 'publishing'; await this.local.save(stored);
        const receipt = await this.operations.execute(`projects/${b.projectId}/datasets/${b.datasetId}/publish`, {
            expectedProjectLifecycleRevision: stored.lifecycleRevision, expectedHead: stored.head, nextManifestHash: hash }, stored.commandOperationId);
        assertSync(receipt.outcome === 'committed', receipt.code ?? 'PUBLISH_REJECTED');
        stored.commandOperationId = receipt.operation.operationId; stored.phase = 'published'; await this.local.save(stored);
    }
    private async acknowledge(): Promise<void> {
        const state = await this.store.read();
        if (!state.ackPending || state.binding.state !== 'active') return;
        try { await this.remote.ack(state.binding.projectId, state.binding.replicaId, state.ackPending.cursor, state.ackPending.scopeRevision); }
        catch (error) {
            if (!(error instanceof SyncError) || error.code !== 'CURSOR_EXPIRED') {
                await this.store.update(s => ({ ...s, ackError: { code: error instanceof SyncError ? error.code : 'ACK_FAILED' } })); return;
            }
        }
        await this.store.update(s => ({ ...s, ackPending: undefined, ackError: undefined }));
    }
    async mergeText(id: string, paths: string[]): Promise<StoredFilePlan> {
        const b = (await this.store.read()).binding;
        return this.exclusive(b.bindingId, async sync => {
            const stored = await sync.local.load(id); assertSync(stored?.phase === 'prepared', 'PLAN_INACTIVE');
            const state = await sync.store.read(); assertBinding(stored.bindingToken, state.binding);
            assertSync(state.binding.direction === 'both', 'TEXT_MERGE_REQUIRES_BIDIRECTIONAL');
                assertSync(stored.scopeToken === canonical(sync.scope), 'PLAN_SCOPE_CHANGED');
            const merged = structuredClone(stored); merged.id = sync.newId();
            for (const path of paths) await sync.mergePath(merged, path);
            await sync.local.save(merged); return merged;
        });
    }
    private async mergePath(stored: StoredFilePlan, path: string): Promise<void> {
        const c = stored.plan.conflicts.find(c => c.path === path);
        assertSync(c?.code === 'CONTENT_CONFLICT' && c.baseline?.kind === 'file' && c.local?.kind === 'file' && c.remote?.kind === 'file', 'TEXT_MERGE_UNAVAILABLE');
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        const texts = await Promise.all([c.baseline.hash, c.local.hash, c.remote.hash].map(async h => decoder.decode(await this.local.object(h))));
        const result = mergeText(texts[0], texts[1], texts[2]); assertSync(!result.conflict && result.merged !== undefined, 'TEXT_MERGE_CONFLICT');
        const bytes = new TextEncoder().encode(result.merged), hash = await this.local.cache(bytes);
        const executable = c.remote.executable === c.baseline.executable ? c.local.executable : c.remote.executable;
        const output = { ...c.remote, hash, size: String(bytes.length), executable: executable ?? false };
        const entries = new Map(stored.plan.manifest.entries.map(e => [e.path, e])); entries.set(path, output);
        stored.plan.manifest.entries = [...entries.values()];
        stored.plan.actions.push({ path, input: c.local, output, side: 'merge' });
        stored.plan.conflicts = stored.plan.conflicts.filter(c => c.path !== path);
    }
    private async uploadMissing(project: string, plan: FilePlan): Promise<void> {
        const hashes = [...new Set(plan.actions.flatMap(a => (a.side === 'upload' || a.side === 'merge') && a.output?.kind === 'file' ? [a.output.hash] : []))];
        for (let start = 0; start < hashes.length; start += 1000) {
            const batch = hashes.slice(start, start + 1000), ready = new Set((await this.remote.check(project, batch)).ready);
            for (const hash of batch) if (!ready.has(hash)) {
                assertSync(await this.remote.upload(project, await this.local.object(hash)) === hash, 'OBJECT_HASH_MISMATCH');
            }
        }
    }
    private async confirmPublication(stored: StoredFilePlan): Promise<void> {
        await this.operations.recover();
        const state = await this.store.read();
        const operation = [...state.history].reverse().find(p => p.command.body.operationId === stored.commandOperationId);
        if (!operation && !state.pending) { stored.phase = 'prepared'; await this.publish(stored); return; }
        assertSync(operation?.receipt?.outcome === 'committed', operation?.receipt?.code ?? 'PUBLICATION_UNCONFIRMED');
        stored.commandOperationId = operation.command.body.operationId; stored.phase = 'published'; await this.local.save(stored);
    }
}
