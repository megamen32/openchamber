# Plugins Module Documentation

## Purpose
This module loads user-owned OpenChamber extension files from the local config directory.

OpenChamber plugins are separate from OpenCode plugins. OpenCode plugins extend OpenCode request/provider behavior, while OpenChamber plugins extend OpenChamber UI/server features. The first supported OpenChamber plugin interface is for quota providers.

## Quota provider plugins
Quota plugins live outside the package directory so they survive package updates:

```text
~/.config/openchamber/plugins/quota/<provider>.js
~/.config/openchamber/plugins/quota/<provider>.mjs
```

Each plugin file should export a default function. The loader calls the function with a context object and expects a provider implementation object in return.

```js
export default ({
  buildResult,
  toUsageWindow,
  readAuthFile,
  getAuthEntry,
  normalizeAuthEntry,
}) => ({
  providerId: 'my-provider',
  providerName: 'My Provider',
  isConfigured: () => {
    const auth = readAuthFile();
    const entry = normalizeAuthEntry(getAuthEntry(auth, ['my-provider']));
    return Boolean(entry?.key || entry?.token);
  },
  fetchQuota: async () => {
    return buildResult({
      providerId: 'my-provider',
      providerName: 'My Provider',
      configured: true,
      usage: {
        windows: {
          daily: toUsageWindow({ usedPercent: 25, remainingPercent: 75 }),
        },
      },
    });
  },
});
```

## Loader context
The quota plugin context currently includes:

- `buildResult`
- `toUsageWindow`
- `toNumber`
- `toTimestamp`
- `formatMoney`
- `readAuthFile`
- `getAuthEntry`
- `normalizeAuthEntry`

These helpers mirror the built-in quota provider helpers so plugin providers can produce the same API shape without importing internal files directly.

## Trust boundary
Plugin files are regular JavaScript modules loaded by the local OpenChamber server. Users should only install plugin files they trust. This is intended for local user customization, not for loading untrusted remote code.
