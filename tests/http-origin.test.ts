import { afterEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { randomId, sha256, scopedStore, OperationManager } from '../src';
import { MemoryState } from './helpers';
afterEach(() => vi.unstubAllGlobals());
it('preserves SHA-256 identities without SubtleCrypto, including padding boundaries and subarrays', async () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const inputs = ['', 'abc', '同步\nSHA-256'].map(text => new TextEncoder().encode(text));
    for (const length of [55, 56, 63, 64, 65, 127, 128, 129, 1024 * 1024])
        inputs.push(Uint8Array.from({ length: length + 4 }, (_, i) => i % 251).subarray(2, length + 2));
    for (const input of inputs) expect(await sha256(input)).toBe(createHash('sha256').update(input).digest('hex'));
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
it('does not hide WebCrypto failures or use insecure randomness', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => { throw new Error('digest failed'); } } });
    await expect(sha256(new Uint8Array())).rejects.toThrow('digest failed');
    expect(() => randomId()).toThrow('SECURE_RANDOM_UNAVAILABLE');
});
it('requires transaction fencing when a coordinator supplies a guard', async () => {
    const store = new MemoryState();
    const coordinator = { exclusive: async <T>(_key: string, action: (guard?: { check(): Promise<void> }) => Promise<T>) => action({ check: async () => {} }) };
    expect(() => scopedStore(store, { check: async () => {} })).toThrow('COORDINATION_FENCING_UNAVAILABLE');
    const remote = { execute: vi.fn(), operation: vi.fn(), cancel: vi.fn(), replica: vi.fn() };
    await expect(new OperationManager(store, remote, coordinator, randomId).execute('publish', {})).rejects.toThrow('COORDINATION_FENCING_UNAVAILABLE');
    expect(remote.execute).not.toHaveBeenCalled();
});
