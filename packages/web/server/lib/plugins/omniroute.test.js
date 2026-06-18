import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PLUGIN_PATH = path.resolve(process.cwd(), 'examples/plugins/quota/omniroute.js');

const ctx = {
  buildResult: ({ providerId, providerName, ok, configured, error, usage }) => ({
    providerId, providerName, ok, configured, error, usage,
  }),
  toUsageWindow: ({ usedPercent, windowSeconds, resetAt, valueLabel }) => ({
    usedPercent, windowSeconds, resetAt, valueLabel,
  }),
  toNumber: (value) => (value == null ? null : Number(value)),
  toTimestamp: (value) => (value == null ? null : new Date(value).getTime()),
  formatMoney: (value) => (value == null ? '-' : Number(value).toFixed(2)),
  readAuthFile: () => ({}),
  getAuthEntry: () => null,
  normalizeAuthEntry: (entry) => entry,
};

describe('omniroute quota plugin', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('is not configured when no auth or env key is available', async () => {
    const mod = await import(PLUGIN_PATH);
    const plugin = mod.default(ctx);
    expect(plugin.isConfigured()).toBe(false);
  });

  it('returns error when the API key is invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    vi.spyOn(ctx, 'readAuthFile').mockReturnValue({ omniroute: { type: 'api', key: 'bad-key' } });
    vi.spyOn(ctx, 'getAuthEntry').mockReturnValue({ type: 'api', key: 'bad-key' });
    vi.spyOn(ctx, 'normalizeAuthEntry').mockImplementation((entry) => entry);

    const mod = await import(PLUGIN_PATH);
    const plugin = mod.default(ctx);
    const result = await plugin.fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid API key');
  });

  it('renders provider usage windows from /api/v1/me/status', async () => {
    vi.spyOn(ctx, 'readAuthFile').mockReturnValue({ omniroute: { type: 'api', key: 'sk-test' } });
    vi.spyOn(ctx, 'getAuthEntry').mockReturnValue({ type: 'api', key: 'sk-test' });
    vi.spyOn(ctx, 'normalizeAuthEntry').mockImplementation((entry) => entry);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        accountQuotas: [
          {
            provider: 'codex',
            quotas: {
              session: { usedPercentage: 3, resetAt: '2026-06-17T00:00:00.000Z' },
              weekly: { usedPercentage: 12, resetAt: '2026-06-23T00:00:00.000Z' },
            },
          },
        ],
      }),
    });

    const mod = await import(PLUGIN_PATH);
    const plugin = mod.default(ctx);
    const result = await plugin.fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usage?.windows).toBeDefined();
    expect(result.usage.windows['Codex (5h)']).toBeDefined();
    expect(result.usage.windows['Codex (5h)'].usedPercent).toBe(3);
    expect(result.usage.windows['Codex (weekly)']).toBeDefined();
    expect(result.usage.windows['Codex (weekly)'].usedPercent).toBe(12);
  });
});
