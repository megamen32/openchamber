// Example OpenChamber quota plugin for OmniRoute.
//
// Copy this file to:
//   ~/.config/openchamber/plugins/quota/omniroute.js
//
// Configure auth without hard-coding secrets in this file:
// - add an `omniroute` auth entry through OpenChamber/OpenCode provider auth, or
// - set OMNIROUTE_API_KEY in the environment that starts OpenChamber.
//
// Optional:
// - OMNIROUTE_BASE_URL defaults to http://localhost:20128

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
  const baseUrl = process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128';

  const providerLabels = {
    codex: 'Codex',
    deepseek: 'DeepSeek',
    glm: 'GLM',
    openrouter: 'OpenRouter',
    'github-models': 'GitHub Models',
    claude: 'Claude',
  };

  const windowLabels = {
    session: '5h',
    weekly: 'weekly',
    credits_usd: 'credits',
    credits: 'credits',
    daily: 'daily',
  };

  const formatTokens = (value) => {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return String(value);
  };

  const getApiKey = () => {
    if (process.env.OMNIROUTE_API_KEY) return process.env.OMNIROUTE_API_KEY;
    const auth = readAuthFile();
    const entry = normalizeAuthEntry(getAuthEntry(auth, ['omniroute']));
    return entry?.key || entry?.token || null;
  };

  return {
    providerId,
    providerName,
    aliases: ['omniroute', 'omni-route', 'omni'],

    isConfigured: () => Boolean(getApiKey()),

    fetchQuota: async () => {
      const apiKey = getApiKey();
      if (!apiKey) {
        return buildResult({
          providerId,
          providerName,
          ok: false,
          configured: false,
          error: 'Not configured. Set OMNIROUTE_API_KEY or add an omniroute auth entry.',
        });
      }

      try {
        const response = await fetch(`${baseUrl}/api/v1/me/status`, {
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          return buildResult({
            providerId,
            providerName,
            ok: false,
            configured: true,
            error: response.status === 401
              ? 'Invalid API key or missing self:usage scope'
              : `OmniRoute API error: ${response.status}`,
          });
        }

        const data = await response.json();
        const windows = {};

        const cost = data?.usage?.cost;
        if (cost) {
          const used = toNumber(cost.usedUsd);
          const limit = toNumber(cost.limitUsd);
          const usedPercent = toNumber(cost.usedPercent);
          windows['Cost (monthly)'] = toUsageWindow({
            usedPercent,
            windowSeconds: null,
            resetAt: toTimestamp(cost.resetAt),
            valueLabel: used != null && limit != null
              ? `$${formatMoney(used)} / $${formatMoney(limit)}`
              : used != null
                ? `$${formatMoney(used)} used`
                : null,
          });
        }

        const tokens = data?.usage?.tokens;
        const totalTokens = toNumber(tokens?.totalTokens);
        if (totalTokens != null) {
          windows['Tokens (month)'] = toUsageWindow({
            usedPercent: null,
            windowSeconds: null,
            resetAt: toTimestamp(tokens?.periodStartAt),
            valueLabel: `${formatTokens(totalTokens)} total`,
          });
        }

        for (const quotaGroup of data?.accountQuotas || []) {
          if (!quotaGroup?.quotas || typeof quotaGroup.quotas !== 'object') continue;
          const providerLabel = providerLabels[quotaGroup.provider] || quotaGroup.provider;
          for (const [windowKey, windowValue] of Object.entries(quotaGroup.quotas)) {
            const windowLabel = windowLabels[windowKey] || windowKey;
            windows[`${providerLabel} (${windowLabel})`] = toUsageWindow({
              usedPercent: toNumber(windowValue.usedPercentage),
              windowSeconds: null,
              resetAt: toTimestamp(windowValue.resetAt),
            });
          }
        }

        return buildResult({
          providerId,
          providerName,
          ok: true,
          configured: true,
          usage: { windows },
        });
      } catch (error) {
        return buildResult({
          providerId,
          providerName,
          ok: false,
          configured: true,
          error: error instanceof Error ? error.message : 'OmniRoute request failed',
        });
      }
    },
  };
};
