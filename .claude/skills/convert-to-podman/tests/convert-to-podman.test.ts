import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('convert-to-podman skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    expect(content).toContain('skill: convert-to-podman');
    expect(content).toContain('version: 1.0.0');
    expect(content).toContain('container-runtime.ts');
    expect(content).toContain('container/build.sh');
  });

  it('has all modified files', () => {
    const runtimeFile = path.join(skillDir, 'modify', 'src', 'container-runtime.ts');
    expect(fs.existsSync(runtimeFile)).toBe(true);

    const content = fs.readFileSync(runtimeFile, 'utf-8');
    expect(content).toContain("CONTAINER_RUNTIME_BIN = 'podman'");
    expect(content).toContain('podman info');
    expect(content).toContain('ps --format json');
    expect(content).toContain('Names');

    const testFile = path.join(skillDir, 'modify', 'src', 'container-runtime.test.ts');
    expect(fs.existsSync(testFile)).toBe(true);

    const testContent = fs.readFileSync(testFile, 'utf-8');
    expect(testContent).toContain('podman info');
    expect(testContent).toContain("'-v'");
  });

  it('has intent files for modified sources', () => {
    const runtimeIntent = path.join(skillDir, 'modify', 'src', 'container-runtime.ts.intent.md');
    expect(fs.existsSync(runtimeIntent)).toBe(true);

    const buildIntent = path.join(skillDir, 'modify', 'container', 'build.sh.intent.md');
    expect(fs.existsSync(buildIntent)).toBe(true);
  });

  it('has build.sh with Podman default', () => {
    const buildFile = path.join(skillDir, 'modify', 'container', 'build.sh');
    expect(fs.existsSync(buildFile)).toBe(true);

    const content = fs.readFileSync(buildFile, 'utf-8');
    expect(content).toContain('CONTAINER_RUNTIME:-podman');
    expect(content).not.toContain('CONTAINER_RUNTIME:-docker');
  });

  it('uses Podman API patterns (not Docker daemon patterns)', () => {
    const runtimeFile = path.join(skillDir, 'modify', 'src', 'container-runtime.ts');
    const content = fs.readFileSync(runtimeFile, 'utf-8');

    // Podman patterns
    expect(content).toContain('podman info');
    expect(content).toContain('ps --format json');
    expect(content).toContain('Names');

    // Should NOT contain Docker-specific patterns
    expect(content).not.toContain('docker info');
    expect(content).not.toContain("--filter name=");
    expect(content).not.toContain("'{{.Names}}'");
  });

  it('preserves Docker-compatible mount syntax', () => {
    const runtimeFile = path.join(skillDir, 'modify', 'src', 'container-runtime.ts');
    const content = fs.readFileSync(runtimeFile, 'utf-8');

    // Podman supports Docker-compatible -v syntax
    expect(content).toContain("'-v'");
    expect(content).toContain(':ro');
  });

  it('has runtimeRunArgs() using --userns=keep-id for rootless Podman fix', () => {
    const runtimeFile = path.join(skillDir, 'modify', 'src', 'container-runtime.ts');
    const content = fs.readFileSync(runtimeFile, 'utf-8');

    expect(content).toContain('runtimeRunArgs');
    expect(content).toContain("'--user', '0:0'");
    expect(content).toContain('HOME=/home/node');
    // Should return empty for root (uid 0) — rootFUL Podman
    expect(content).toContain('hostUid === 0');
  });

  it('has container-runner.ts using runtimeRunArgs() instead of inline uid check', () => {
    const runnerFile = path.join(skillDir, 'modify', 'src', 'container-runner.ts');
    expect(fs.existsSync(runnerFile)).toBe(true);

    const content = fs.readFileSync(runnerFile, 'utf-8');

    // Uses the abstracted function
    expect(content).toContain('runtimeRunArgs');
    // Imports it from container-runtime
    expect(content).toContain("runtimeRunArgs, stopContainer } from './container-runtime.js'");
    // Should NOT contain the Docker-style inline uid check
    expect(content).not.toContain("'--user'");
    expect(content).not.toContain('hostUid !== 1000');
  });

  it('has intent file for container-runner.ts changes', () => {
    const runnerIntent = path.join(skillDir, 'modify', 'src', 'container-runner.ts.intent.md');
    expect(fs.existsSync(runnerIntent)).toBe(true);

    const content = fs.readFileSync(runnerIntent, 'utf-8');
    expect(content).toContain('userns=keep-id');
  });
});
