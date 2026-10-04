import { it, expect } from 'vitest';
import { mergeText } from '../src';
it('preserves distinct line replacements over a range of base positions', () => {
    for (let count = 2; count < 12; count++) {
        const base = Array.from({ length: count }, (_, i) => 'line-' + i + '\n');
        for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) if (a !== b) {
            const local = [...base], remote = [...base], expected = [...base];
            local[a] = expected[a] = 'local-' + a + '\n'; remote[b] = expected[b] = 'remote-' + b + '\n';
            expect(mergeText(base.join(''), local.join(''), remote.join('')).merged).toBe(expected.join(''));
        }
    }
});
