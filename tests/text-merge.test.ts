import { it, expect } from 'vitest';
import { mergeText } from '../src';
it('merges distinct text edits against the actual base', () => {
    expect(mergeText('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n')).toEqual({ merged: 'A\nb\nC\n', conflict: false });
});
it('retains conflicts when edits overlap', () => {
    expect(mergeText('a\nb\n', 'a\nB1\n', 'a\nB2\n').conflict).toBe(true);
});
it('merges disjoint insertion and deletion without changing line endings', () => {
    expect(mergeText('a\r\nb\r\nc\r\n', 'a\r\nx\r\nb\r\nc\r\n', 'a\r\nb\r\n').merged).toBe('a\r\nx\r\nb\r\n');
});
it('does not accept conflicting insertions at the same position', () => {
    expect(mergeText('a\n', 'x\na\n', 'y\na\n').conflict).toBe(true);
});
it('rejects binary or excessive inputs instead of pretending to merge them', () => {
    expect(mergeText('a\0', 'b\0', 'c\0').unavailable).toBe(true);
    expect(mergeText('a\n'.repeat(1100), 'b\n'.repeat(1100), 'c\n'.repeat(1100)).unavailable).toBe(true);
});
