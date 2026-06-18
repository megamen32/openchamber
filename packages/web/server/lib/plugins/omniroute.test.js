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

  it('renders provider usage windows from /api/usage/quota and /api/usage/provider-limits', async () => {
    vi.spyOn(ctx, 'readAuthFile').mockReturnValue({ omniroute: { type: 'api', key: 'sk-test' } });
    vi.spyOn(ctx, 'getAuthEntry').mockReturnValue({ type: 'api', key: 'sk-test' });
    vi.spyOn(ctx, 'normalizeAuthEntry').mockImplementation((entry) => entry);

    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/usage/quota')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            providers: [
              { name: 'Test Codex', provider: 'codex', connectionId: 'conn-1', quotaUsed: 5, quotaTotal: 100 },
            ],
            meta: { generatedAt: '2026-06-17T00:00:00.000Z', filters: {} },
          }),
        });
      }
      if (url.includes('/api/usage/provider-limits')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            caches: {
              'conn-1': {
                quotas: {
                  session: { used: 3, total: 100, remaining: 97, remainingPercentage: 97, resetAt: '2026-06-17T00:00:00.000Z', unlimited: false },
                  weekly: { used: 12, total: 100, remaining: 88, remainingPercentage: 88, resetAt: '2026-06-23T00:00:00.000Z', unlimited: false },
                },
                plan: 'test',
              },
            },
            intervalMinutes: 60,
            lastAutoSyncAt: '2026-06-17T00:00:00.000Z',
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const mod = await import(PLUGIN_PATH);
    const plugin = mod.default(ctx);
    const result = await plugin.fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usage?.windows).toBeDefined();
    expect(result.usage.windows['codex (5h)']).toBeDefined();
    expect(result.usage.windows['codex (5h)'].usedPercent).toBe(3);
    expect(result.usage.windows['codex (weekly)']).toBeDefined();
    expect(result.usage.windows['codex (weekly)'].usedPercent).toBe(12);
  });

  it('does not surface raw fetch failed network errors in the UI result', async () => {
    vi.spyOn(ctx, 'readAuthFile').mockReturnValue({ omniroute: { type: 'api', key: 'sk-test' } });
    vi.spyOn(ctx, 'getAuthEntry').mockReturnValue({ type: 'api', key: 'sk-test' });
    vi.spyOn(ctx, 'normalizeAuthEntry').mockImplementation((entry) => entry);
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const mod = await import(PLUGIN_PATH);
    const plugin = mod.default(ctx);
    const result = await plugin.fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toContain('Unable to reach OmniRoute quota API');
    expect(result.error).not.toBe('fetch failed');
  });

});
