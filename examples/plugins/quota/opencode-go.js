// Example OpenChamber quota plugin for OpenCode Go.
//
// OpenCode Go is a low-cost subscription plan that gives reliable access to
// popular open coding models through OpenCode's gateway.
//
// Docs:
//   https://opencode.ai/docs/go
//   https://opencode.ai/docs/providers#opencode-go
//
// Auth storage:
//   `~/.local/share/opencode/auth.json` with key `opencode-go` (type: "api").
//   Already read automatically via the plugin loader's `getAuthEntry` helper.
//
// Usage console:
//   https://opencode.ai/auth (current usage is visible in the OpenCode
//   workspace console; there is no documented public usage REST API).
//
// To install:
//   cp examples/plugins/quota/opencode-go.js \
//      ~/.config/openchamber/plugins/quota/opencode-go.js
//
// The plugin is intentionally conservative: it only reports provider
// configuration status. If a usage API endpoint is published, replace
// `fetchQuota` with the real implementation.

export default ({
  buildResult,
  readAuthFile,
  getAuthEntry,
  normalizeAuthEntry,
}) => {
  const providerId = 'opencode-go';
  const providerName = 'OpenCode Go';
  const aliases = ['opencode-go', 'opencode_zen_go', 'opengogo'];

  const getApiKey = () => {
    const auth = readAuthFile();
    const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
    return entry?.key || entry?.token || null;
  };

  return {
    providerId,
    providerName,
    aliases,

    isConfigured: () => Boolean(getApiKey()),

    // TODO: replace with a real usage fetch once OpenCode publishes a public
    // usage API. The OpenCode team tracks Go usage inside the workspace
    // console at https://opencode.ai/auth but does not currently expose a
    // documented REST endpoint for it.
    //
    // Suggested implementation shape (do not enable until endpoint exists):
    //   const res = await fetch('https://opencode.ai/zen/go/v1/usage', {
    //     headers: { Authorization: `Bearer ${apiKey.trim()}` },
    //   });
    //   const data = await res.json();
    //   return buildResult({
    //     providerId,
    //     providerName,
    //     ok: true,
    //     configured: true,
    //     usage: { windows: { /* map data to UsageWindow entries */ } },
    //   });
    fetchQuota: async () => {
      const apiKey = getApiKey();
      if (!apiKey) {
        return buildResult({
          providerId,
          providerName,
          ok: false,
          configured: false,
          error: 'Not configured. Run /connect in OpenCode and pick OpenCode Go.',
        });
      }

      return buildResult({
        providerId,
        providerName,
        ok: true,
        configured: true,
        usage: null,
        // OpenCode does not currently expose a usage API for Go. Track usage
        // in the OpenCode console: https://opencode.ai/auth
        error: 'Usage API not yet available. See https://opencode.ai/auth for current usage.',
      });
    },
  };
};
