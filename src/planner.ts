import type { FileAction, FileConflict, FileEntry, FilePlan, FilesManifest, Observation, Scope, Snapshot } from './contracts';
import { canonical, comparePaths } from './encoding';
import { assertSync } from './errors';

export function selected(path: string, scope: Scope): boolean {
    return scope.includes.some(p => under(path, p)) && !scope.excludes.some(p => under(path, p));
}
function under(path: string, parent: string): boolean { return !parent || path === parent || path.startsWith(parent + '/'); }
function observed(path: string, snapshot: Snapshot): Observation {
    if (Object.hasOwn(snapshot.entries, path)) return snapshot.entries[path];
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (snapshot.completeDirectories.includes(parent)) return { state: 'absent' };
    if (parent && observed(parent, snapshot).state === 'absent') return { state: 'absent' };
    if (Object.entries(snapshot.entries).some(([p, o]) => o.state === 'absent' && under(path, p))) return { state: 'absent' };
    return { state: 'unknown', code: 'SCAN_INCOMPLETE' };
}
function equal(a?: FileEntry, b?: FileEntry): boolean {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'directory') return true;
    const file = b as Extract<FileEntry, { kind: 'file' }>;
    return a.hash === file.hash && a.size === file.size && (a.executable ?? false) === (file.executable ?? false);
}
function localEntry(o: Observation, remote?: FileEntry, base?: FileEntry): FileEntry | undefined {
    if (o.state !== 'present') return undefined;
    if (o.entry.kind !== 'file' || o.executable === 'known') return o.entry;
    const attributes = remote?.kind === 'file' ? remote : base?.kind === 'file' ? base : undefined;
    return { ...o.entry, executable: attributes?.executable ?? false };
}
function comparisonBase(base: FileEntry | undefined, o: Observation, remote?: FileEntry): FileEntry | undefined {
    if (o.state !== 'present' || o.executable !== 'unavailable' || base?.kind !== 'file') return base;
    return { ...base, executable: remote?.kind === 'file' ? remote.executable ?? false : base.executable };
}
export function planFileSync(baseline: FileEntry[], snapshot: Snapshot, cloud: FilesManifest, scope: Scope,
    direction: 'both' | 'upload' | 'download' = 'both'): FilePlan {
    const base = new Map(baseline.map(e => [e.path, e]));
    const remote = new Map(cloud.entries.map(e => [e.path, e]));
    const paths = [...new Set([...base.keys(), ...remote.keys(), ...Object.keys(snapshot.entries)])].sort(comparePaths);
    const plan: FilePlan = { manifest: { ...cloud, entries: [...cloud.entries] }, actions: [], conflicts: [], degraded: [] };
    for (const path of paths) {
        if (!selected(path, scope)) continue;
        const observation = observed(path, snapshot);
        const b = base.get(path), r = remote.get(path);
        if (observation.state === 'unknown' || observation.state === 'unsupported') {
            plan.conflicts.push({ path, code: observation.code, baseline: b, remote: r }); continue;
        }
        if (observation.state === 'present' && observation.executable === 'unavailable' && r?.kind === 'file' && r.executable)
            plan.degraded.push({ path, attribute: 'executable' });
        const l = localEntry(observation, r, b);
        classify(plan, path, comparisonBase(b, observation, r), l, r, scope, direction);
    }
    protectGroups(plan, paths, snapshot, scope);
    const next = new Map(cloud.entries.map(e => [e.path, e]));
    for (const a of plan.actions) if (a.side === 'upload') { if (a.output) next.set(a.path, a.output); else next.delete(a.path); }
    plan.manifest.entries = [...next.values()].sort((a, b) => comparePaths(a.path, b.path));
    return plan;
}
function classify(plan: FilePlan, path: string, b: FileEntry | undefined, l: FileEntry | undefined,
    r: FileEntry | undefined, scope: Scope, direction: 'both' | 'upload' | 'download'): void {
    if (equal(l, r)) { plan.actions.push({ path, input: l, output: r, side: 'confirm' }); return; }
    if ((l && r && l.kind !== r.kind) || (!equal(l, b) && !equal(r, b))) {
        plan.conflicts.push({ path, code: 'CONTENT_CONFLICT', baseline: b, local: l, remote: r }); return;
    }
    const side = equal(l, b) ? 'download' : 'upload', output = side === 'upload' ? l : r;
    if (direction !== 'both' && direction !== side) return;
    if (!output && !scope.propagateDeletes) {
        plan.conflicts.push({ path, code: 'DELETE_REQUIRES_POLICY', baseline: b, local: l, remote: r }); return;
    }
    plan.actions.push({ path, input: side === 'upload' ? r : l, output, side });
}
function protectGroups(plan: FilePlan, paths: string[], snapshot: Snapshot, scope: Scope): void {
    const blocked = new Set<string>();
    for (const action of plan.actions) {
        const removesDirectory = action.input?.kind === 'directory' && action.output?.kind !== 'directory';
        if (!removesDirectory) continue;
        const children = paths.filter(p => p !== action.path && under(p, action.path));
        const unsafe = children.some(p => !selected(p, scope) || ['unknown', 'unsupported'].includes(observed(p, snapshot).state)
            || plan.conflicts.some(c => under(c.path, action.path)));
        if (unsafe || scope.excludes.some(p => under(p, action.path)) || (observed(action.path, snapshot).state !== 'absent' && !snapshot.completeDirectories.includes(action.path))) {
            for (const p of [action.path, ...children]) blocked.add(p);
            plan.conflicts.push({ path: action.path, code: 'DIRECTORY_GROUP_BLOCKED' });
        }
    }
    // A child cannot be applied if its parent has a type or lifecycle conflict.
    for (const c of plan.conflicts) for (const a of plan.actions) if (under(a.path, c.path)) blocked.add(a.path);
    plan.actions = plan.actions.filter(a => !blocked.has(a.path));
}
export function bindingToken(binding: unknown): string { return canonical(binding); }
export function assertBinding(expected: string, binding: unknown): void {
    assertSync(expected === bindingToken(binding), 'PLAN_BINDING_CHANGED');
}
export function applyBaseline(entries: FileEntry[], actions: FileAction[]): FileEntry[] {
    const next = new Map(entries.map(e => [e.path, e]));
    for (const a of actions) { if (a.output) next.set(a.path, a.output); else next.delete(a.path); }
    return [...next.values()].sort((a, b) => comparePaths(a.path, b.path));
}
export type { FileConflict };
