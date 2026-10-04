import type { Head, StateStore } from './contracts';
import { SyncError, assertSync, decimal, validId } from './errors';
import { bindingToken, assertBinding } from './planner';
export interface RemoteDataset { datasetId: string; kind: string; logicalId: string; state: string; head: Head }
export interface CatalogPage { datasets: RemoteDataset[]; cursor: string; nextCursor: string | null; changesCursor: string }
export interface ChangePage { changes: { dataset?: RemoteDataset; type: string; sequence: string }[]; cursor: string; hasMore: boolean }
export interface DiscoveryRemote {
    catalog(project: string, cursor?: string): Promise<CatalogPage>;
    changes(project: string, cursor: string): Promise<ChangePage>;
}
export async function discoverDatasets(store: StateStore, remote: DiscoveryRemote): Promise<{ datasets: RemoteDataset[]; cursor: string }> {
    const state = await store.read(), token = bindingToken(state.binding);
    let result: { datasets: RemoteDataset[]; cursor: string };
    try {
        result = state.discovery ? await increment(remote, state.binding.projectId, state.discovery)
            : await fullCatalog(remote, state.binding.projectId);
    } catch (error) {
        if (!(error instanceof SyncError) || error.code !== 'CURSOR_EXPIRED') throw error;
        result = await fullCatalog(remote, state.binding.projectId);
    }
    await store.update(s => { assertBinding(token, s.binding); return { ...s, discovery: result }; });
    return result;
}
async function fullCatalog(remote: DiscoveryRemote, project: string): Promise<{ datasets: RemoteDataset[]; cursor: string }> {
    const datasets: RemoteDataset[] = []; let next: string | undefined, page: CatalogPage;
    do { page = await remote.catalog(project, next); page.datasets.forEach(validateDataset); datasets.push(...page.datasets);
        next = page.nextCursor ?? undefined; } while (next);
    return { datasets, cursor: page.changesCursor };
}
async function increment(remote: DiscoveryRemote, project: string, previous: { datasets: RemoteDataset[]; cursor: string }) {
    const datasets = new Map(previous.datasets.map(d => [d.datasetId, d])); let cursor = previous.cursor, page: ChangePage;
    do {
        page = await remote.changes(project, cursor);
        for (const event of page.changes) {
            decimal(event.sequence);
            if (event.dataset) { validateDataset(event.dataset); datasets.set(event.dataset.datasetId, event.dataset); }
        }
        cursor = page.cursor;
    } while (page.hasMore);
    return { datasets: [...datasets.values()], cursor };
}
function validateDataset(dataset: RemoteDataset): void {
    validId(dataset.datasetId); validId(dataset.logicalId); decimal(dataset.head.generation);
    assertSync(['active', 'deleted'].includes(dataset.state) && /^[a-f0-9]{64}$/.test(dataset.head.manifestHash), 'INVALID_SYNC_DATASET');
}
