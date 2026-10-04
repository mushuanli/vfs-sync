export interface Head { generation: string; manifestHash: string }
export type FileEntry = { kind: 'directory'; path: string } | {
    kind: 'file'; path: string; hash: string; size: string; executable?: boolean;
};
export interface FilesManifest { format: 'fs-agent.files'; version: 1; entries: FileEntry[] }
export interface Command {
    target: string;
    body: { operationId: string; replicaId: string; opSeq: string; authorityId: string; historyEpoch: string; [key: string]: unknown };
}
export interface Receipt {
    operation: { operationId: string; replicaId: string; opSeq: string; historyEpoch: string };
    outcome: 'committed' | 'not-committed' | 'unknown';
    result?: Record<string, unknown>;
    code?: string;
    state?: 'pending';
}
export interface PendingCommand { command: Command; receipt?: Receipt; terminalExpired?: boolean }
export interface Binding {
    bindingId: string; bindingRevision: string; locatorRevision: string; policyRevision: string;
    scopeRevision: string; state: 'active' | 'detaching' | 'detached';
    authorityId: string; namespaceId: string; historyEpoch: string;
    projectId: string; localProjectId: string; replicaId: string;
    sourceId: string; root: string; datasetId: string;
    connectionId?: string;
    direction: 'both' | 'upload' | 'download';
}
export interface SyncState {
    schemaVersion: 1;
    setupPending?: boolean;
    binding: Binding; nextSeq: string; baseline: FileEntry[];
    pending?: PendingCommand; history: PendingCommand[]; activePlanId?: string;
    discovery?: { datasets: import('./discovery').RemoteDataset[]; cursor: string };
    ackError?: { code: string };
    ackPending?: { cursor: string; scopeRevision: string };
}
export interface StateStore {
    read(): Promise<SyncState>;
    update(change: (current: SyncState) => SyncState): Promise<SyncState>;
}
export interface Coordinator { exclusive<T>(key: string, action: () => Promise<T>): Promise<T> }
export interface CommandRemote {
    execute(command: Command): Promise<Receipt>;
    operation(replicaId: string, seq: string): Promise<Receipt>;
    cancel(command: Command): Promise<Receipt>;
    replica(replicaId: string): Promise<{ state: string; lastAdmittedSeq: string }>;
}
export type Observation = { state: 'present'; entry: FileEntry; executable: 'known' | 'unavailable' }
    | { state: 'absent' } | { state: 'unknown' | 'unsupported'; code: string };
export interface Snapshot {
    entries: Record<string, Observation>;
    completeDirectories: string[];
}
export interface Scope { includes: string[]; excludes: string[]; propagateDeletes: boolean }
export interface FileAction { path: string; input?: FileEntry; output?: FileEntry; side: 'upload' | 'download' | 'confirm' | 'merge' }
export interface FileConflict { path: string; code: string; baseline?: FileEntry; local?: FileEntry; remote?: FileEntry }
export interface FilePlan { manifest: FilesManifest; actions: FileAction[]; conflicts: FileConflict[]; degraded: { path: string; attribute: string }[]; warnings?: string[] }
