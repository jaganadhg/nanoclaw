---
name: convert-to-podman
description: Switch container runtime from Docker to Podman. Use when the user wants Podman instead of Docker, or is setting up on Linux with rootless containers. Triggers on "podman", "convert to podman", "switch to podman", "use podman", "install with podman".
---

# Convert to Podman

This skill switches NanoClaw's container runtime from Docker to Podman. It uses the skills engine for deterministic code changes, then walks through verification.

**What this changes:**
- Container runtime binary: `docker` → `podman`
- Startup check: `docker info` → `podman info` (daemonless, no auto-start needed)
- Orphan detection: `docker ps --filter --format '{{.Names}}'` → `podman ps --format json` with JSON parsing
- Build script default: `docker` → `podman`
- User mapping: `--user hostUid:hostGid` → `--userns=keep-id` (fixes rootless Podman rw mounts)

**What stays the same:**
- Mount syntax: `-v path:path:ro` / `-v path:path` (Podman is Docker CLI-compatible)
- Dockerfile (shared by both runtimes)
- Mount security/allowlist validation
- All other functionality

**Rootless Podman and UID mapping:**
In rootless Podman, the kernel user namespace maps container uid 0 → host user, and all
other container UIDs → subuid offsets. Passing `--user hostUid:hostGid` does NOT give the
container access to host files because the container's uid maps to a subuid, not to the
actual host uid. This skill uses `--user 0:0` instead: uid 0 inside a rootless container IS
the host user, so bind-mounted directories are accessible immediately — no image-layer copies,
no pre-chown steps required.

## Prerequisites

Verify Podman is installed:

```bash
podman --version && echo "Podman ready" || echo "Install Podman first"
```

If not installed:

**Ubuntu/Debian:**
```bash
sudo apt-get update && sudo apt-get install -y podman
```

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install -y podman
```

**Arch Linux:**
```bash
sudo pacman -S podman
```

**macOS (requires Podman Machine):**
```bash
brew install podman
podman machine init
podman machine start
```

Verify after install:
```bash
podman info
```

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `convert-to-podman` is in `applied_skills`, skip to Phase 3 (Verify). The code changes are already in place.

### Check current runtime

```bash
grep "CONTAINER_RUNTIME_BIN" src/container-runtime.ts
```

If it already shows `'podman'`, the runtime is already Podman. Skip to Phase 3.

## Phase 2: Apply Code Changes

Run the skills engine to apply this skill's code package. The package files are in this directory alongside this SKILL.md.

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

Or call `initSkillsSystem()` from `skills-engine/migrate.ts`.

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/convert-to-podman
```

This deterministically:
- Replaces `src/container-runtime.ts` with the Podman implementation
- Replaces `src/container-runtime.test.ts` with Podman-specific tests
- Updates `container/build.sh` to default to `podman` runtime
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/container-runtime.ts.intent.md` — what changed and invariants
- `modify/container/build.sh.intent.md` — what changed for build script

### Validate code changes

```bash
npm test
npm run build
```

All tests must pass and build must be clean before proceeding.

## Phase 3: Verify

### Check Podman is available

```bash
podman info
```

On macOS, if Podman Machine isn't running:
```bash
podman machine start
```

### Build the container image

```bash
./container/build.sh
```

### Test basic execution

```bash
echo '{}' | podman run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK"
```

### Test readonly mounts

```bash
mkdir -p /tmp/test-ro && echo "test" > /tmp/test-ro/file.txt
podman run --rm --entrypoint /bin/bash \
  -v /tmp/test-ro:/test:ro \
  nanoclaw-agent:latest \
  -c "cat /test/file.txt && touch /test/new.txt 2>&1 || echo 'Write blocked (expected)'"
rm -rf /tmp/test-ro
```

Expected: Read succeeds, write fails with "Read-only file system".

### Test read-write mounts

The code adds `--user 0:0 -e HOME=/home/node` via `runtimeRunArgs()`. Include them here to match actual runtime behavior:

```bash
mkdir -p /tmp/test-rw
podman run --rm --user 0:0 -e HOME=/home/node --entrypoint /bin/bash \
  -v /tmp/test-rw:/test \
  nanoclaw-agent:latest \
  -c "echo 'test write' > /test/new.txt && cat /test/new.txt"
cat /tmp/test-rw/new.txt && rm -rf /tmp/test-rw
```

Expected: Both operations succeed. Files created in the container are owned by the host user.

### Test orphan cleanup simulation

```bash
# Start a named container
podman run -d --name nanoclaw-test-orphan --entrypoint /bin/sleep nanoclaw-agent:latest 60

# Verify it appears in ps JSON
podman ps --format json | grep nanoclaw-test-orphan

# Stop it
podman stop nanoclaw-test-orphan
podman rm nanoclaw-test-orphan
```

### Full integration test

```bash
npm run build
npm run dev
```

Send a message via WhatsApp and verify the agent responds.

**On Linux with systemd service:**
```bash
systemctl --user restart nanoclaw
journalctl --user -u nanoclaw -f
```

## Troubleshooting

**Podman not found:**
```bash
which podman || echo "Podman not installed"
sudo apt-get install -y podman   # Ubuntu/Debian
sudo dnf install -y podman       # Fedora/RHEL
```

**Rootless Podman: subuid/subgid not configured:**
```bash
grep $(whoami) /etc/subuid /etc/subgid
# If missing, add entries:
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $(whoami)
podman system migrate
```

**Podman info fails:**
```bash
podman system reset   # reset Podman state (WARNING: removes all containers/images)
podman info
```

**Image build fails (stale cache):**
```bash
# Force clean rebuild
podman system prune --all --force
./container/build.sh
```

**Container can't write to mounted directories:**
Check directory permissions on the host. The container runs as uid 1000. For rootless Podman, the UID mapping may shift:
```bash
podman unshare ls -la /path/to/directory
```

**On macOS: Podman Machine not running:**
```bash
podman machine list
podman machine start
```

**On Windows (native Node.js — not WSL2): container can't write to mounted directories:**

`process.getuid()` is unavailable on native Windows, so the UID fix (`--user 0:0`) is not
applied. The container runs as the `node` user (uid 1000), which maps to a subuid in the
Podman VM and cannot write to host-owned directories.

**Recommended fix:** Run NanoClaw inside WSL2 instead of native Windows. WSL2 provides a
full Linux environment where `process.getuid()` works correctly and `--user 0:0` is applied
automatically.

If WSL2 is not an option, pre-chown the data directories so the container's uid can access
them. Inside WSL2 or a Linux shell connected to your Podman Machine:
```bash
# Find the subuid that Podman maps uid 1000 to
podman run --rm --entrypoint /bin/sh nanoclaw-agent:latest -c "id"

# Chown the data directories to that uid (replace <subuid> with the value from above)
podman unshare chown -R 1000:1000 ./data ./groups
```

## Summary of Changed Files

| File | Type of Change |
|------|----------------|
| `src/container-runtime.ts` | Full replacement — Docker → Podman API, adds `runtimeRunArgs()` |
| `src/container-runtime.test.ts` | Full replacement — tests for Podman behavior |
| `src/container-runner.ts` | Swap inline uid check for `runtimeRunArgs()` call |
| `container/build.sh` | Default runtime: `docker` → `podman` |
