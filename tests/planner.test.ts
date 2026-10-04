import { describe, it, expect } from 'vitest';
import { planFileSync, encodeManifest, resolveFileConflicts, type FileEntry, type Snapshot, type Scope } from '../src';
const f = (path: string, n: string, executable = false): FileEntry => ({ kind: 'file', path, hash: n.repeat(64), size: '1', executable });
const cloud = (entries: FileEntry[]) => ({ format: 'fs-agent.files' as const, version: 1 as const, entries });
const scope: Scope = { includes: [''], excludes: [], propagateDeletes: true };
const scan = (entries: FileEntry[]): Snapshot => ({ entries: Object.fromEntries(entries.map(entry => [entry.path,
    { state: 'present', entry, executable: 'known' }])), completeDirectories: ['', ...entries.filter(e => e.kind === 'directory').map(e => e.path)] });
describe('file reconciliation boundaries', () => {
    it('inherits unselected remote content and merges distinct files', () => {
        const base = [f('a', '0'), f('b', '0'), f('docs', '0')];
        const plan = planFileSync(base, scan([f('a', '1'), f('b', '0')]), cloud([f('a', '0'), f('b', '2'), f('docs', '3')]),
            { ...scope, includes: ['a', 'b'] });
        expect(plan.conflicts).toEqual([]);
        expect(plan.manifest.entries).toEqual([f('a', '1'), f('b', '2'), f('docs', '3')]);
        expect(plan.actions.find(a => a.path === 'b')?.side).toBe('download');
    });
    it('does not translate incomplete enumeration into deletion', () => {
        const plan = planFileSync([f('src/a', '0')], { entries: { src: { state: 'present', entry: { kind: 'directory', path: 'src' }, executable: 'unavailable' } }, completeDirectories: [''] }, cloud([f('src/a', '0')]), scope);
        expect(plan.actions.filter(a => a.path === 'src/a')).toEqual([]); expect(plan.conflicts[0].code).toBe('SCAN_INCOMPLETE');
    });
    it('retains unsupported files instead of deleting them', () => {
        const plan = planFileSync([f('a', '0')], { entries: { a: { state: 'unsupported', code: 'TOO_LARGE' } }, completeDirectories: [''] }, cloud([f('a', '0')]), scope);
        expect(plan.manifest.entries).toEqual([f('a', '0')]); expect(plan.actions).toEqual([]);
    });
    it('blocks parent deletion containing excluded children', () => {
        const entries: FileEntry[] = [{ kind: 'directory', path: 'dir' }, f('dir/keep', '0')];
        const plan = planFileSync(entries, { entries: { dir: { state: 'absent' } }, completeDirectories: ['', 'dir'] },
            cloud(entries), { ...scope, excludes: ['dir/keep'] });
        expect(plan.actions).toEqual([]); expect(plan.manifest.entries).toEqual(entries);
    });
    it('preserves cloud executable when the local backend cannot read it', () => {
        const s = scan([f('run.sh', '1')]);
        (s.entries['run.sh'] as { executable: string }).executable = 'unavailable';
        const plan = planFileSync([f('run.sh', '0', true)], s, cloud([f('run.sh', '0', true)]), scope);
        expect(plan.manifest.entries).toEqual([f('run.sh', '1', true)]);
    });
    it('preserves both sides of concurrent change', () => {
        const plan = planFileSync([f('a', '0')], scan([f('a', '1')]), cloud([f('a', '2')]), scope);
        expect(plan.conflicts[0].code).toBe('CONTENT_CONFLICT'); expect(plan.manifest.entries).toEqual([f('a', '2')]);
    });
    it('resolves only explicit captured conflicts and respects direction', () => {
        const plan = planFileSync([f('a', '0')], scan([f('a', '1')]), cloud([f('a', '2')]), scope);
        expect(resolveFileConflicts(plan, { a: 'local' }, 'both').manifest.entries).toEqual([f('a', '1')]);
        expect(() => resolveFileConflicts(plan, { a: 'local' }, 'download')).toThrow('DIRECTION_NOT_ALLOWED');
    });
    it('rejects invalid parents and produces canonical bytes', () => {
        expect(() => encodeManifest(cloud([f('a/b', '0')]))).toThrow('INVALID_SYNC_PARENT');
        expect(new TextDecoder().decode(encodeManifest(cloud([])))).toBe('{"entries":[],"format":"fs-agent.files","version":1}');
    });
});
