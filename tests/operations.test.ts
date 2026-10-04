import { describe, it, expect } from 'vitest';
import { OperationManager, SyncError, type Command, type CommandRemote, type Receipt } from '../src';
import { MemoryState, SerialCoordinator } from './helpers';
const receipt = (c: Command, outcome: Receipt['outcome'] = 'committed'): Receipt => ({ operation: c.body, outcome });
function remote(overrides: Partial<CommandRemote> = {}): CommandRemote {
    return { execute: async c => receipt(c), operation: async () => { throw new SyncError('NOT_FOUND', 'not-committed', 404); },
        cancel: async c => ({ ...receipt(c, 'not-committed'), code: 'CANCELLED' }), replica: async () => ({ state: 'active', lastAdmittedSeq: '1' }), ...overrides };
}
describe('durable operation sequences', () => {
    it('persists command before sending and confirms a lost response without replay', async () => {
        const store = new MemoryState(); let sent = 0;
        const r = remote({ execute: async () => { expect(store.state.pending).toBeDefined(); sent++; throw new Error('disconnect'); },
            operation: async () => receipt(store.state.pending!.command) });
        const manager = new OperationManager(store, r, new SerialCoordinator(), () => 'op');
        await expect(manager.execute('projects', {})).rejects.toThrow('disconnect');
        await manager.recover(); expect(sent).toBe(1); expect(store.state.pending).toBeUndefined(); expect(store.state.nextSeq).toBe('2');
    });
    it('retains pending results and refuses the next sequence', async () => {
        const store = new MemoryState(), r = remote({ execute: async c => receipt(c, 'unknown'), operation: async () => receipt(store.state.pending!.command, 'unknown') });
        const m = new OperationManager(store, r, new SerialCoordinator(), () => 'op');
        await expect(m.execute('projects', {})).rejects.toThrow('OPERATION_PENDING');
        await expect(m.execute('projects', {})).rejects.toThrow('OPERATION_PENDING'); expect(store.state.nextSeq).toBe('2');
    });
    it('keeps expired outcome unknown until explicit content reconciliation', async () => {
        const store = new MemoryState(), r = remote({ execute: async () => { throw new Error('offline'); },
            operation: async () => { throw new SyncError('OPERATION_EXPIRED', 'not-committed', 410); } });
        const m = new OperationManager(store, r, new SerialCoordinator(), () => 'op');
        await expect(m.execute('projects', {})).rejects.toThrow('offline');
        await expect(m.recover()).rejects.toThrow('RECONCILIATION_REQUIRED');
        expect(store.state.pending?.terminalExpired).toBe(true); expect(store.state.pending?.receipt).toBeUndefined();
        await m.acknowledgeExpiredReconciliation(); expect(store.state.history[0].terminalExpired).toBe(true);
    });
    it('consumes a cancelled allocated command rather than leaving a sequence hole', async () => {
        const store = new MemoryState(), m = new OperationManager(store, remote({ execute: async () => { throw new Error('not sent'); } }), new SerialCoordinator(), () => 'op');
        await expect(m.execute('projects', {})).rejects.toThrow(); await m.cancel();
        expect(store.state.history[0].receipt?.code).toBe('CANCELLED'); expect(store.state.nextSeq).toBe('2');
    });
    it('does not accept a receipt for another operation', async () => {
        const store = new MemoryState(), m = new OperationManager(store, remote({ execute: async c => ({ ...receipt(c), operation: { ...c.body, operationId: 'other' } }) }), new SerialCoordinator(), () => 'op');
        await expect(m.execute('projects', {})).rejects.toThrow('RECEIPT_IDENTITY_MISMATCH'); expect(store.state.pending).toBeDefined();
    });
});
