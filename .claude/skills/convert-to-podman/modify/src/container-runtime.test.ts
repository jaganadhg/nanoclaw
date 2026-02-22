import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process — store the mock fn so tests can configure it
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  runtimeRunArgs,
  stopContainer,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
} from './container-runtime.js';
import { logger } from './logger.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Pure functions ---

describe('readonlyMountArgs', () => {
  it('returns -v flag with :ro suffix (Docker-compatible syntax)', () => {
    const args = readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
  });
});

describe('stopContainer', () => {
  it('returns stop command using CONTAINER_RUNTIME_BIN', () => {
    expect(stopContainer('nanoclaw-test-123')).toBe(
      `${CONTAINER_RUNTIME_BIN} stop nanoclaw-test-123`,
    );
  });
});

// --- runtimeRunArgs ---

describe('runtimeRunArgs', () => {
  const originalGetuid = process.getuid;

  afterEach(() => {
    Object.defineProperty(process, 'getuid', { value: originalGetuid, configurable: true });
  });

  it('returns --user 0:0 and HOME for a normal user (uid 1001)', () => {
    Object.defineProperty(process, 'getuid', { value: () => 1001, configurable: true });
    expect(runtimeRunArgs()).toEqual(['--user', '0:0', '-e', 'HOME=/home/node']);
  });

  it('returns --user 0:0 and HOME for uid 1000', () => {
    Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true });
    expect(runtimeRunArgs()).toEqual(['--user', '0:0', '-e', 'HOME=/home/node']);
  });

  it('returns empty array for root (uid 0) to keep container as node user', () => {
    Object.defineProperty(process, 'getuid', { value: () => 0, configurable: true });
    expect(runtimeRunArgs()).toEqual([]);
  });

  it('returns empty array when getuid is unavailable (Windows)', () => {
    Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
    expect(runtimeRunArgs()).toEqual([]);
  });
});

// --- ensureContainerRuntimeRunning ---

describe('ensureContainerRuntimeRunning', () => {
  it('does nothing when runtime is already running', () => {
    mockExecSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      `${CONTAINER_RUNTIME_BIN} info`,
      { stdio: 'pipe', timeout: 10000 },
    );
    expect(logger.debug).toHaveBeenCalledWith('Container runtime already running');
  });

  it('throws when podman info fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('Cannot connect to Podman');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans ---

describe('cleanupOrphans', () => {
  it('stops orphaned nanoclaw containers from JSON output', () => {
    // Podman ps --format json returns array with Names array and State field
    const psOutput = JSON.stringify([
      { Names: ['nanoclaw-group1-111'], State: 'running' },
      { Names: ['nanoclaw-group2-222'], State: 'running' },
      { Names: ['other-container'], State: 'running' },
    ]);
    mockExecSync.mockReturnValueOnce(psOutput);
    // stop calls succeed
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    // ps + 2 stop calls (only nanoclaw- containers)
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      `${CONTAINER_RUNTIME_BIN} stop nanoclaw-group1-111`,
      { stdio: 'pipe' },
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      `${CONTAINER_RUNTIME_BIN} stop nanoclaw-group2-222`,
      { stdio: 'pipe' },
    );
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['nanoclaw-group1-111', 'nanoclaw-group2-222'] },
      'Stopped orphaned containers',
    );
  });

  it('does nothing when no orphans exist', () => {
    mockExecSync.mockReturnValueOnce('[]');

    cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns and continues when ps fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('podman not available');
    });

    cleanupOrphans(); // should not throw

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to clean up orphaned containers',
    );
  });

  it('continues stopping remaining containers when one stop fails', () => {
    const psOutput = JSON.stringify([
      { Names: ['nanoclaw-a-1'], State: 'running' },
      { Names: ['nanoclaw-b-2'], State: 'running' },
    ]);
    mockExecSync.mockReturnValueOnce(psOutput);
    // First stop fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('already stopped');
    });
    // Second stop succeeds
    mockExecSync.mockReturnValueOnce('');

    cleanupOrphans(); // should not throw

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['nanoclaw-a-1', 'nanoclaw-b-2'] },
      'Stopped orphaned containers',
    );
  });

  it('skips non-nanoclaw containers', () => {
    const psOutput = JSON.stringify([
      { Names: ['some-other-app'], State: 'running' },
      { Names: ['nanoclaw-mygroup-999'], State: 'running' },
    ]);
    mockExecSync.mockReturnValueOnce(psOutput);
    mockExecSync.mockReturnValue('');

    cleanupOrphans();

    // ps + 1 stop call only
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      `${CONTAINER_RUNTIME_BIN} stop nanoclaw-mygroup-999`,
      { stdio: 'pipe' },
    );
  });
});
