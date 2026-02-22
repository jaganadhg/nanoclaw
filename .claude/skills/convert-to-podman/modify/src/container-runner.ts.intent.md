# Intent: src/container-runner.ts modifications

## What changed
Replaced the inline host-UID check with a call to `runtimeRunArgs()` from `container-runtime.ts`.

## Key sections

### Import (line 20)
- Added: `runtimeRunArgs` to the import from `./container-runtime.js`

### buildContainerArgs — user mapping (was lines 198–204)
- Removed: inline `process.getuid()` / `--user hostUid:hostGid` / `-e HOME=/home/node` block
- Added: `args.push(...runtimeRunArgs())`

## Why the old approach broke in rootless Podman

In rootless Podman, every container gets its own user namespace. The current host user
(e.g. uid 1001) is mapped to uid 0 in the user namespace, and subuids are assigned to
other values. Passing `--user 1001:1001` inside a rootless container does NOT mean the
process runs as host uid 1001 on disk — it maps to a subuid (e.g. uid 101001), which
doesn't own any host directories. Hence bind-mounted rw dirs are inaccessible.

## What --user 0:0 does in rootless Podman

In rootless Podman, the user namespace maps container uid 0 to the host user's uid.
Passing `--user 0:0` runs the container process as uid 0 in that namespace, which
equals the host user on disk. The container can read and write any file owned by the
host user, with no image-layer copies and no pre-chown steps.

This differs from `--userns=keep-id` (which requires an expensive per-image layer
copy for large images) and from `--user hostUid:hostGid` (which maps to a subuid
offset, not the host user's uid).

## Invariants
- All exported functions and their signatures are unchanged
- Mount assembly logic is unchanged
- Timeout and streaming logic are unchanged
- Only `buildContainerArgs` has a behaviour change (user mapping strategy)

## Must-keep
- The `runtimeRunArgs()` call must stay in `buildContainerArgs`, before the mount loop
