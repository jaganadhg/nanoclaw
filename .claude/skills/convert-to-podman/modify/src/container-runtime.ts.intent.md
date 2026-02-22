# Intent: src/container-runtime.ts modifications

## What changed
Replaced Docker runtime with Podman runtime. This is a full file replacement — the exported API is identical, only the implementation differs.

## Key sections

### CONTAINER_RUNTIME_BIN
- Changed: `'docker'` → `'podman'`

### readonlyMountArgs
- Unchanged: Podman supports Docker-compatible `-v host:container:ro` syntax

### ensureContainerRuntimeRunning
- Changed: `docker info` → `podman info` (same command, Podman is Docker CLI-compatible)
- Removed: no auto-start needed — Podman is daemonless on Linux and works immediately after install
- Changed: error message references Podman, adds macOS hint (`podman machine start`)

### cleanupOrphans
- Changed: `docker ps --filter name=nanoclaw- --format '{{.Names}}'` → `podman ps --format json` with JSON parsing
- Podman returns JSON array with `{ Names: string[], State: string }` per container
- Filter: `Names.some(n => n.startsWith('nanoclaw-'))` instead of server-side `--filter`
- `podman ps` (without `-a`) only lists running containers, so no State filter needed

### runtimeRunArgs (new)
- Added: returns `['--user', '0:0', '-e', 'HOME=/home/node']` for non-root host users
- Returns `[]` when host uid is 0 (rootFUL Podman) or unavailable (Windows)
- Replaces the inline `--user hostUid:hostGid` check in container-runner.ts, which
  does not work in rootless Podman's user namespace (hostUid N in the container maps
  to a subuid offset on the host, not to the actual host uid N)
- In rootless Podman: uid 0 in the user namespace = the host user → instant file access,
  no image-layer copies (unlike --userns=keep-id), no pre-chown steps

## Invariants
- All six exports remain with identical signatures: `CONTAINER_RUNTIME_BIN`, `readonlyMountArgs`, `runtimeRunArgs`, `stopContainer`, `ensureContainerRuntimeRunning`, `cleanupOrphans`
- `stopContainer` implementation is unchanged (`<bin> stop <name>`)
- `readonlyMountArgs` implementation is unchanged (Podman uses Docker-compatible `-v` syntax)
- Logger usage pattern is unchanged
- Error handling pattern is unchanged

## Must-keep
- The exported function signatures (consumed by container-runner.ts and index.ts)
- The error box-drawing output format
- The orphan cleanup logic (find + stop pattern)
