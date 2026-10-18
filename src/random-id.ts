import { assertSync } from './errors';

/** Secure bytes remain available on HTTP origins where randomUUID is not exposed. */
export function randomId(): string {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === 'function') {
        try {return crypto.randomUUID();} catch { /* Fall back to secure bytes. */ }
    }
    assertSync(typeof crypto?.getRandomValues === 'function', 'SECURE_RANDOM_UNAVAILABLE');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
