# @itookit/vfs-sync

Platform-independent multi-device file synchronization with **zero runtime package dependencies**.
Includes three-way comparison, bounded text merge, canonical manifests, dataset
discovery, recoverable publication, operation sequences and receipt reconciliation.

No dependency on vfs-core, drivers, UI, filesystem or HTTP packages. Hosts inject
local storage, remote protocol and coordination ports. Current wire contracts
follow fs-agent; session history synchronization is outside this package.

## Development

```sh
git clone git@github.com:mushuanli/vfs-sync.git
cd vfs-sync
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

No submodules or Rust server are needed. Protocol fixtures are stored in this
repository with their upstream provenance. CI uses Node.js 22.

## Usage

```ts
import { encodeManifest, sha256, mergeText } from '@itookit/vfs-sync';

const bytes = encodeManifest({ format: 'fs-agent.files', version: 1, entries: [] });
const digest = await sha256(bytes);
const result = mergeText('first\nsecond\n', 'edited\nsecond\n', 'first\nupdated\n');
```

`FileSync` takes `StateStore`, `FileLocal`, `FileRemote`, `Coordinator`, an ID
factory and a `Scope`. The host chooses project binding, direction, exclusions,
delete propagation and conflict decisions. Concrete adapters must provide
snapshot completeness, durable control records and conditional application;
ordinary file read/write cannot substitute for those guarantees.

`OperationManager` persists commands before submission, retains unknown results
and requires reconciliation when terminal receipts expire. Cloud publication and
local application remain separate recoverable boundaries.

The runtime must provide Web Crypto (`crypto.subtle`), `TextEncoder`, `TextDecoder`
and `structuredClone`. Browser applications require a secure context for Web Crypto.
No DOM or native host modules are imported by the implementation.

Source exports are used for workspace development. `pnpm pack` replaces them
with ESM/CJS and declaration exports from `publishConfig`.

## itookit integration

In itookit the repository is mounted at `packages/vfs-sync` as a Git submodule:

```sh
git submodule update --init packages/vfs-sync
```

Host-specific implementations stay in sync-adapters; neither core module depends
on the other. See [AGENTS.md](AGENTS.md) for implementation invariants.
