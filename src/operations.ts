import type { Binding, Command, CommandRemote, Coordinator, Receipt, StateStore } from './contracts';
import { assertSync, decimal, nextDecimal, SyncError } from './errors';

export class OperationManager {
    constructor(private readonly store: StateStore, private readonly remote: CommandRemote,
        private readonly coordinator: Coordinator, private readonly newId: () => string) {}
    async execute(target: string, payload: Record<string, unknown>, operationId = this.newId()): Promise<Receipt> {
        const state = await this.store.read();
        return this.coordinator.exclusive(sequenceKey(state.binding), async () => {
            await this.recoverUnlocked();
            const allocated = await this.store.update(current => allocate(current, target, payload, operationId));
            return this.send(allocated.pending!.command);
        });
    }
    async recover(): Promise<void> {
        const state = await this.store.read();
        await this.coordinator.exclusive(sequenceKey(state.binding), () => this.recoverUnlocked());
    }
    private async recoverUnlocked(): Promise<void> {
        const { pending } = await this.store.read();
        if (!pending) return;
        try { await this.finish(pending.command, await this.remote.operation(pending.command.body.replicaId, pending.command.body.opSeq)); }
        catch (error) { await this.recoverError(pending.command, error); }
    }
    private async recoverError(command: Command, error: unknown): Promise<void> {
        if (!(error instanceof SyncError)) throw error;
        if (error.code === 'NOT_FOUND' && error.status === 404) { await this.send(command); return; }
        if (error.code !== 'OPERATION_EXPIRED' || error.status !== 410) throw error;
        const progress = await this.remote.replica(command.body.replicaId);
        assertSync(decimal(progress.lastAdmittedSeq) >= decimal(command.body.opSeq));
        // Content reconciliation is still required before allocating the next command.
        await this.store.update(s => ({ ...s, pending: { ...s.pending!, terminalExpired: true } }));
        throw new SyncError('RECONCILIATION_REQUIRED', 'unknown');
    }
    async acknowledgeExpiredReconciliation(): Promise<void> {
        const state = await this.store.read();
        await this.coordinator.exclusive(sequenceKey(state.binding), async () => {
            await this.store.update(s => {
                assertSync(s.pending?.terminalExpired, 'RECONCILIATION_REQUIRED');
                return { ...s, history: [...s.history, s.pending], pending: undefined };
            });
        });
    }
    async cancel(): Promise<void> {
        const state = await this.store.read();
        await this.coordinator.exclusive(sequenceKey(state.binding), async () => {
            const pending = (await this.store.read()).pending;
            if (pending) await this.finish(pending.command, await this.remote.cancel(pending.command));
        });
    }
    private async send(command: Command): Promise<Receipt> {
        const receipt = await this.remote.execute(command);
        await this.finish(command, receipt);
        return receipt;
    }
    private async finish(command: Command, receipt: Receipt): Promise<void> {
        const identity = receipt.operation;
        assertSync(identity && ['operationId', 'replicaId', 'opSeq', 'historyEpoch'].every(key =>
            identity[key as keyof typeof identity] === command.body[key]), 'RECEIPT_IDENTITY_MISMATCH');
        assertSync(['committed', 'not-committed', 'unknown'].includes(receipt.outcome));
        await this.store.update(s => {
            assertSync(s.pending?.command.body.operationId === command.body.operationId);
            const pending = { command, receipt };
            return receipt.outcome === 'unknown' ? { ...s, pending } : { ...s, pending: undefined, history: [...s.history, pending] };
        });
        if (receipt.outcome === 'unknown') throw new SyncError('OPERATION_PENDING', 'unknown');
    }
}
function sequenceKey(b: Binding): string { return `${b.authorityId}/${b.historyEpoch}/${b.replicaId}`; }
function allocate(s: import('./contracts').SyncState, target: string, payload: Record<string, unknown>, id: string) {
    assertSync(s.binding.state === 'active', 'BINDING_INACTIVE');
    assertSync(!s.pending, 'OPERATION_PENDING');
    const b = s.binding;
    const command: Command = { target, body: { ...payload, operationId: id, replicaId: b.replicaId,
        opSeq: s.nextSeq, authorityId: b.authorityId, historyEpoch: b.historyEpoch } };
    return { ...s, nextSeq: nextDecimal(s.nextSeq), pending: { command } };
}
