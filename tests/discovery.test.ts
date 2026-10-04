import { it, expect } from 'vitest';
import { discoverDatasets, SyncError, type RemoteDataset } from '../src';
import { MemoryState } from './helpers';
const dataset: RemoteDataset = { datasetId: 'files', kind: 'files', logicalId: 'files', state: 'active', head: { generation: '1', manifestHash: 'a'.repeat(64) } };
it('joins a fixed catalog to incremental discovery without changing the baseline', async () => {
    const state = new MemoryState(); let catalogs = 0;
    const remote = { catalog: async () => { catalogs++; return { datasets: [dataset], cursor: 'catalog', nextCursor: null, changesCursor: 'first' }; },
        changes: async () => ({ changes: [{ dataset: { ...dataset, head: { ...dataset.head, generation: '2' } }, type: 'dataset-published', sequence: '2' }], cursor: 'second', hasMore: false }) };
    await discoverDatasets(state, remote); const next = await discoverDatasets(state, remote);
    expect(catalogs).toBe(1); expect(next.datasets[0].head.generation).toBe('2'); expect(state.state.baseline).toEqual([]);
});
it('rebuilds expired discovery while preserving local content evidence', async () => {
    const state = new MemoryState(); state.state.discovery = { datasets: [dataset], cursor: 'expired' };
    const next = await discoverDatasets(state, { changes: async () => { throw new SyncError('CURSOR_EXPIRED'); },
        catalog: async () => ({ datasets: [dataset], cursor: 'cat', nextCursor: null, changesCursor: 'fresh' }) });
    expect(next.cursor).toBe('fresh'); expect(state.state.history).toEqual([]);
});
