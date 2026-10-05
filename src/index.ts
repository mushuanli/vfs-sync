export type { Head, FileEntry, FilesManifest, Command, Receipt, PendingCommand, Binding, SyncState,
    StateStore, Coordinator, CoordinationGuard, CommandRemote, Observation, Snapshot, Scope, FileAction, FileConflict, FilePlan } from './contracts';
export { SyncError, assertSync, decimal, nextDecimal, validId, validPath } from './errors';
export { canonical, comparePaths, encodeManifest, sha256, validateEntries } from './encoding';
export { OperationManager } from './operations';
export { planFileSync, selected, bindingToken, assertBinding, applyBaseline } from './planner';
export { FileSync } from './file-sync';
export type { FileRemote, FileLocal, StoredFilePlan } from './file-sync';
export { resolveFileConflicts } from './resolve';
export { mergeText } from './text-merge';
export type { TextMergeResult } from './text-merge';
export { discoverDatasets } from './discovery';
export type { RemoteDataset, CatalogPage, ChangePage, DiscoveryRemote } from './discovery';
export { scopedStore } from './coordination';
export { randomId } from './random-id';
