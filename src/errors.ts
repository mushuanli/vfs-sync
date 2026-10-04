export class SyncError extends Error {
    constructor(readonly code: string, readonly outcome: 'unknown' | 'not-committed' = 'not-committed', readonly status?: number) {
        super(code); this.name = 'SyncError';
    }
}
export function assertSync(value: unknown, code = 'INVALID_SYNC_DATA'): asserts value {
    if (!value) throw new SyncError(code);
}
export function decimal(value: string): bigint {
    assertSync(/^(0|[1-9][0-9]*)$/.test(value));
    const number = BigInt(value);
    assertSync(number <= 18446744073709551615n);
    return number;
}
export function nextDecimal(value: string): string { return decimal((decimal(value) + 1n).toString()).toString(); }
export function validId(value: string): void { assertSync(/^[a-zA-Z0-9_-]{1,128}$/.test(value)); }
export function validPath(value: string): void {
    assertSync(new TextEncoder().encode(value).length <= 4096 && !/[\\\x00]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..'), 'INVALID_SYNC_PATH');
}
