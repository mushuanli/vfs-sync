import { readFile } from 'node:fs/promises';
import { it, expect } from 'vitest';
import { encodeManifest, sha256 } from '../src';
it('matches fs-agent canonical manifest fixtures byte for byte', async () => {
    const fixtures = JSON.parse(await readFile(new URL('./fixtures/manifests.json', import.meta.url), 'utf8'));
    for (const fixture of fixtures) {
        const bytes = encodeManifest(JSON.parse(fixture.canonical));
        expect(new TextDecoder().decode(bytes)).toBe(fixture.canonical); expect(await sha256(bytes)).toBe(fixture.sha256);
    }
});
