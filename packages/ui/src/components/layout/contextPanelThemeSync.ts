export type EmbeddedChatThemeSyncPayload = Record<string, unknown>;

export const getEmbeddedChatThemeSync = (
  frameWindow: Window | null | undefined,
): ((themePayload: EmbeddedChatThemeSyncPayload) => void) | null => {
  if (!frameWindow) {
    return null;
  }

  try {
    const directThemeSync = (frameWindow as unknown as {
      __openchamberApplyThemeSync?: unknown;
    }).__openchamberApplyThemeSync;

    return typeof directThemeSync === 'function'
      ? (directThemeSync as (themePayload: EmbeddedChatThemeSyncPayload) => void)
      : null;
  } catch {
    // Accessing a named property on a cross-origin frame Window can throw a
    // SecurityError. In that case callers should fall back to postMessage.
    return null;
  }
};
