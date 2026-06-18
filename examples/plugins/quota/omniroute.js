import fs from 'fs';
import os from 'os';
import path from 'path';

// Example OpenChamber quota plugin for OmniRoute.
//
// Copy this file to:
//   ~/.config/openchamber/plugins/quota/omniroute.js
//
// Configure auth without hard-coding secrets in this file:
// - add an `omniroute` auth entry through OpenChamber/OpenCode provider auth, or
// - set OMNIROUTE_API_KEY in the environment that starts OpenChamber.
//
// Base URL is resolved from the OpenCode provider config or local OmniRoute config.
// Environment variables are only a last-resort fallback for custom deployments.

export default ({
  buildResult,
  toUsageWindow,
  toNumber,
  toTimestamp,
  formatMoney,
  readAuthFile,
  getAuthEntry,
  normalizeAuthEntry,
}) => {
  const providerId = 'omniroute';
  const providerName = 'OmniRoute';
  const normalizeBaseUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    return value.replace(/\/+$/, '').replace(/\/v1$/i, '');
  };

  const readJsonFile = (filePath) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const readEnvFile = (filePath) => {
    try {
      if (!fs.existsSync(filePath)) return {};
      return Object.fromEntries(
        fs.readFileSync(filePath, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#') && line.includes('='))
          .map((line) => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
          }),
      );
    } catch {
      return {};
    }
  };

  const resolveBaseUrl = () => {
    const auth = readAuthFile();
    const entry = normalizeAuthEntry(getAuthEntry(auth, ['omniroute']));
    const authBaseUrl = normalizeBaseUrl(entry?.baseURL || entry?.baseUrl || entry?.url || entry?.endpoint);
    if (authBaseUrl) return authBaseUrl;

    const openCodeConfig = readJsonFile(path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'));
    const providerBaseUrl = normalizeBaseUrl(
      openCodeConfig?.provider?.omniroute?.options?.baseURL
        || openCodeConfig?.provider?.omniroute?.options?.baseUrl
        || openCodeConfig?.provider?.omniroute?.baseURL
        || openCodeConfig?.provider?.omniroute?.baseUrl,
    );

    // The OpenCode chat API may use the public /v1 endpoint, while quota endpoints
    // are served by the local OmniRoute dashboard/API on this host. Prefer the
    // local OmniRoute PORT from its own config when the provider points at OmniRoute.
    if (providerBaseUrl && !/omniroute/i.test(providerBaseUrl)) return providerBaseUrl;

    const omniEnv = readEnvFile(path.join(os.homedir(), '.omniroute', '.env'));
    const localPort = omniEnv.PORT || omniEnv.DASHBOARD_PORT || omniEnv.API_PORT;
    if (localPort) return `http://127.0.0.1:${localPort}`;

    return providerBaseUrl || normalizeBaseUrl(process.env.OMNIROUTE_BASE_URL) || 'http://127.0.0.1:20130';
  };


  const WINDOW_LABELS = {
    session: '5h',
    weekly: 'weekly',
    credits_usd: 'credits',
    credits: 'credits',
    daily: 'daily',
    mcp_monthly: 'MCP monthly',
  };

  const getApiKey = () => {
    const auth = readAuthFile();
    const entry = normalizeAuthEntry(getAuthEntry(auth, ['omniroute']));
    return entry?.key || entry?.token || null;
  };

  const authHeaders = () => {
    const apiKey = getApiKey();
    return apiKey
      ? { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' }
      : null;
  };

  const safeFetch = async (baseUrl, pathname) => {
    const headers = authHeaders();
    if (!headers) throw new Error('Not configured');
    const response = await fetch(`${baseUrl}${pathname}`, { headers });
    if (!response.ok) {
      const message = response.status === 401
        ? 'Invalid API key or missing scopes'
        : `OmniRoute API error: ${response.status}`;
      throw new Error(message);
    }
    return response.json();
  };

  const formatTokens = (value) => {
    if (value == null) return '-';
    const n = Number(value);
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  const aggregateByProvider = (providerMap, limits) => {
    const windowsByProvider = {};

    for (const [connectionId, info] of Object.entries(limits)) {
      const provider = providerMap[connectionId];
      if (!provider || !info?.quotas) continue;

      if (!windowsByProvider[provider]) {
        windowsByProvider[provider] = {};
      }

      for (const [windowKey, windowValue] of Object.entries(info.quotas)) {
        const label = WINDOW_LABELS[windowKey] || windowValue.displayName || windowKey;
        const title = `${provider} (${label})`;
        const existing = windowsByProvider[provider][title];
        const used = toNumber(windowValue.used);
        const total = toNumber(windowValue.total);
        const usedPercent = total != null && total > 0
          ? Math.round(((used ?? 0) / total) * 1000) / 10
          : toNumber(windowValue.remainingPercentage) != null
            ? 100 - toNumber(windowValue.remainingPercentage)
            : null;
        const resetAt = toTimestamp(windowValue.resetAt);

        if (!existing) {
          windowsByProvider[provider][title] = {
            used: used ?? 0,
            total,
            usedPercent,
            resetAt,
            unlimited: windowValue.unlimited === true,
          };
        } else {
          existing.used += used ?? 0;
          if (existing.total != null && total != null) {
            existing.total += total;
          } else if (total != null) {
            existing.total = total;
          }
          existing.usedPercent = existing.total != null && existing.total > 0
            ? Math.round((existing.used / existing.total) * 1000) / 10
            : existing.usedPercent;
          if (resetAt != null && (existing.resetAt == null || resetAt < existing.resetAt)) {
            existing.resetAt = resetAt;
          }
          existing.unlimited = existing.unlimited && windowValue.unlimited === true;
        }
      }
    }

    const windows = {};
    for (const providerWindows of Object.values(windowsByProvider)) {
      for (const [title, aggregate] of Object.entries(providerWindows)) {
        let valueLabel = null;
        if (aggregate.unlimited) {
          valueLabel = `${formatTokens(aggregate.used)} used`;
        } else if (aggregate.total != null && aggregate.total > 0) {
          valueLabel = `${formatTokens(aggregate.used)} / ${formatTokens(aggregate.total)}`;
        } else if (aggregate.used != null) {
          valueLabel = `${formatTokens(aggregate.used)} used`;
        }
        windows[title] = toUsageWindow({
          usedPercent: aggregate.usedPercent,
          windowSeconds: null,
          resetAt: aggregate.resetAt,
          valueLabel,
        });
      }
    }

    return windows;
  };

  return {
    providerId,
    providerName,
    aliases: ['omniroute', 'omni-route', 'omni'],

    isConfigured: () => Boolean(getApiKey()),

    fetchQuota: async () => {
      let baseUrl = resolveBaseUrl();
      try {
        const headers = authHeaders();
        if (!headers) {
          return buildResult({
            providerId,
            providerName,
            ok: false,
            configured: false,
            error: 'Not configured. Set OMNIROUTE_API_KEY or add an omniroute auth entry.',
          });
        }

        const [quotaResponse, limitsResponse] = await Promise.all([
          safeFetch(baseUrl, '/api/usage/quota'),
          safeFetch(baseUrl, '/api/usage/provider-limits'),
        ]);

        const providerMap = {};
        for (const entry of quotaResponse?.providers || []) {
          if (entry?.connectionId && entry?.provider) {
            providerMap[entry.connectionId] = entry.provider;
          }
        }

        // /api/usage/provider-limits returns { caches: { connId: { quotas, plan, ... } },
        // intervalMinutes, lastAutoSyncAt } — fall back to the flat map shape so
        // direct fetches (and existing tests) still work.
        const limitsMap = (limitsResponse && typeof limitsResponse === 'object'
          && limitsResponse.caches && typeof limitsResponse.caches === 'object')
          ? limitsResponse.caches
          : (limitsResponse || {});

        const windows = aggregateByProvider(providerMap, limitsMap);

        return buildResult({
          providerId,
          providerName,
          ok: true,
          configured: true,
          usage: { windows },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'unknown error');
        const isNetworkFailure = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(message);
        return buildResult({
          providerId,
          providerName,
          ok: false,
          configured: true,
          error: isNetworkFailure
            ? `Unable to reach OmniRoute quota API at ${baseUrl}`
            : `Failed to fetch OmniRoute quota: ${message}`,
        });
      }
    },
  };
};
