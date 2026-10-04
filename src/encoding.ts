import { assertSync, decimal, validPath } from './errors';
import type { FilesManifest, FileEntry } from './contracts';

export function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        assertSync(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isSafeInteger(value)));
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => {
        assertSync(/^[\x20-\x7e]+$/.test(key));
        return JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key]);
    }).join(',') + '}';
}
export function comparePaths(a: string, b: string): number {
    const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
}
export function validateEntries(entries: FileEntry[]): void {
    const paths = new Map<string, FileEntry>();
    for (const entry of entries) {
        validPath(entry.path); assertSync(!paths.has(entry.path));
        const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
        assertSync(!parent || paths.get(parent)?.kind === 'directory', 'INVALID_SYNC_PARENT');
        if (entry.kind === 'file') {
            assertSync(/^[a-f0-9]{64}$/.test(entry.hash)); decimal(entry.size);
            assertSync(entry.executable === undefined || typeof entry.executable === 'boolean');
        } else assertSync(entry.kind === 'directory');
        paths.set(entry.path, entry);
    }
}
export function encodeManifest(manifest: FilesManifest): Uint8Array<ArrayBuffer> {
    assertSync(manifest.format === 'fs-agent.files' && manifest.version === 1);
    const entries = [...manifest.entries].sort((a, b) => comparePaths(a.path, b.path));
    validateEntries(entries);
    return new TextEncoder().encode(canonical({ ...manifest, entries }));
}
export async function sha256(bytes: Uint8Array): Promise<string> {
    const result = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
