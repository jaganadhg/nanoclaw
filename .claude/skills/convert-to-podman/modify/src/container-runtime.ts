/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'podman';

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, { stdio: 'pipe', timeout: 10000 });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Podman is installed: podman --version               ║',
    );
    console.error(
      '║  2. Run: podman info                                           ║',
    );
    console.error(
      '║  3. On macOS, run: podman machine start                        ║',
    );
    console.error(
      '║  4. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start');
  }
}

/**
 * Returns runtime-specific args to add to every container run command.
 *
 * Rootless Podman remaps UIDs via a user namespace: the host user (e.g. uid 1000)
 * becomes uid 0 inside the user namespace, and subuids fill the rest. Passing
 * --user hostUid:hostGid does NOT give the container the host user's disk permissions
 * because the container's uid N maps to a subuid offset, not to hostUid on the host.
 *
 * The fix: --user 0:0 runs the container as uid 0 in the user namespace, which is
 * exactly the host user. No image-layer copies are needed (unlike --userns=keep-id),
 * and no pre-chown steps are required.
 *
 * We skip this when running as actual root (hostUid 0) — that is rootFUL Podman where
 * uid 0 in the container is real root on the host, which we don't want.
 */
export function runtimeRunArgs(): string[] {
  const hostUid = process.getuid?.();
  if (hostUid == null || hostUid === 0) return [];
  return ['--user', '0:0', '-e', 'HOME=/home/node'];
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --format json`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const containers: { Names: string[]; State: string }[] = JSON.parse(output || '[]');
    const orphans = containers
      .filter((c) => c.Names.some((n) => n.startsWith('nanoclaw-')))
      .map((c) => c.Names[0]);
    for (const name of orphans) {
      try {
        execSync(stopContainer(name), { stdio: 'pipe' });
      } catch { /* already stopped */ }
    }
    if (orphans.length > 0) {
      logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
