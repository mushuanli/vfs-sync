import { assertSync } from './errors';
import type { CoordinationGuard, StateStore } from './contracts';

/** Guarded coordinators require ports that validate ownership at the storage boundary. */
export function scopedStore(store: StateStore, guard?: CoordinationGuard): StateStore {
    if (!guard) return store;
    assertSync(store.scoped, 'COORDINATION_FENCING_UNAVAILABLE');
    return store.scoped(guard);
}
