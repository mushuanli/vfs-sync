import type { FilePlan } from './contracts';
import { assertSync } from './errors';
import { comparePaths } from './encoding';

/** Resolve only captured file conflicts; unknown scans and directory groups remain blocked. */
export function resolveFileConflicts(plan: FilePlan, decisions: Record<string, 'local' | 'remote'>,
    direction: 'both' | 'upload' | 'download'): FilePlan {
    const next = structuredClone(plan), entries = new Map(next.manifest.entries.map(e => [e.path, e]));
    for (const [path, choice] of Object.entries(decisions)) {
        const conflict = next.conflicts.find(c => c.path === path);
        assertSync(conflict?.code === 'CONTENT_CONFLICT' && ['local', 'remote'].includes(choice), 'INVALID_CONFLICT_DECISION');
        assertSync(conflict.local?.kind !== 'directory' && conflict.remote?.kind !== 'directory', 'DIRECTORY_CONFLICT_UNRESOLVED');
        assertSync(!next.conflicts.some(c => c.path !== path && path.startsWith(c.path + '/')), 'PARENT_CONFLICT_UNRESOLVED');
        const side = choice === 'local' ? 'upload' : 'download';
        assertSync(direction === 'both' || direction === side, 'DIRECTION_NOT_ALLOWED');
        const output = choice === 'local' ? conflict.local : conflict.remote;
        next.actions.push({ path, input: choice === 'local' ? conflict.remote : conflict.local, output, side });
        if (side === 'upload') { if (output) entries.set(path, output); else entries.delete(path); }
        next.conflicts = next.conflicts.filter(c => c.path !== path);
    }
    next.manifest.entries = [...entries.values()].sort((a, b) => comparePaths(a.path, b.path)); return next;
}
