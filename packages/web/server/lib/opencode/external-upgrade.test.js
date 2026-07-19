import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { assertLocalExternalHost, upgradeExternalOpenCode } from './external-upgrade.js';

const createSuccessfulChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit('data', 'OpenCode upgraded successfully\n');
    child.emit('close', 0, null);
  });
  return child;
};

describe('external OpenCode upgrade', () => {
  it('accepts loopback external servers', () => {
    expect(assertLocalExternalHost('http://127.0.0.1:4096').hostname).toBe('127.0.0.1');
    expect(assertLocalExternalHost('http://localhost:4096').hostname).toBe('localhost');
  });

  it('rejects remote external servers before running a local command', () => {
    expect(() => assertLocalExternalHost('https://opencode.example.com:4096')).toThrow(/remote/i);
  });

  it('runs the resolved OpenCode CLI upgrade without a shell', async () => {
    const spawn = vi.fn(() => createSuccessfulChild());

    const result = await upgradeExternalOpenCode({
      baseUrl: 'http://127.0.0.1:4096',
      binary: '/tmp/opencode',
      target: '1.17.18',
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith(
      '/tmp/opencode',
      ['upgrade', '1.17.18'],
      expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    expect(result).toMatchObject({ success: true, method: 'cli', restartRequired: true });
  });

  it('does not accept an empty target as an argument', async () => {
    const spawn = vi.fn(() => createSuccessfulChild());

    await upgradeExternalOpenCode({
      baseUrl: 'http://127.0.0.1:4096',
      binary: '/tmp/opencode',
      target: '   ',
      spawn,
    });

    expect(spawn.mock.calls[0][1]).toEqual(['upgrade']);
  });
});
