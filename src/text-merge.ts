export interface TextMergeResult { merged?: string; conflict: boolean; unavailable?: boolean }
interface Edit { start: number; end: number; lines: string[] }
const MAX_CELLS = 1000000;
/** Bounded line-based three-way merge; overlapping edits remain explicit conflicts. */
export function mergeText(base: string, local: string, remote: string): TextMergeResult {
    if ([base, local, remote].some(s => s.includes('\0') || s.length > 262144)) return { conflict: true, unavailable: true };
    if (local === remote) return { merged: local, conflict: false };
    if (base === local) return { merged: remote, conflict: false };
    if (base === remote) return { merged: local, conflict: false };
    const b = lines(base), l = lines(local), r = lines(remote);
    if ((b.length + 1) * Math.max(l.length + 1, r.length + 1) > MAX_CELLS) return { conflict: true, unavailable: true };
    const edits = [...diff(b, l), ...diff(b, r)].sort((a, z) => a.start - z.start || a.end - z.end);
    const combined: Edit[] = [];
    for (const edit of edits) {
        const prior = combined.at(-1);
        if (prior && prior.start === edit.start && prior.end === edit.end && prior.lines.join('') === edit.lines.join('')) continue;
        if (prior && (edit.start < prior.end || edit.start === prior.start)) return { conflict: true };
        combined.push(edit);
    }
    let cursor = 0, result = '';
    for (const edit of combined) { result += b.slice(cursor, edit.start).join('') + edit.lines.join(''); cursor = edit.end; }
    return { merged: result + b.slice(cursor).join(''), conflict: false };
}
function lines(text: string): string[] { return text ? text.split(/(?<=\n)/) : []; }
function diff(base: string[], changed: string[]): Edit[] {
    const width = changed.length + 1, dp = new Uint32Array((base.length + 1) * width);
    for (let i = base.length - 1; i >= 0; i--) for (let j = changed.length - 1; j >= 0; j--) {
        dp[i * width + j] = base[i] === changed[j] ? 1 + dp[(i + 1) * width + j + 1]
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
    const edits: Edit[] = []; let i = 0, j = 0, current: Edit | undefined;
    while (i < base.length || j < changed.length) {
        if (i < base.length && j < changed.length && base[i] === changed[j]) {
            if (current) edits.push(current); current = undefined; i++; j++; continue;
        }
        current ??= { start: i, end: i, lines: [] };
        if (j < changed.length && (i === base.length || dp[i * width + j + 1] >= dp[(i + 1) * width + j])) current.lines.push(changed[j++]);
        else current.end = ++i;
    }
    if (current) edits.push(current); return edits;
}
