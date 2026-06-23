export type EmbeddedChatVisibilityPayload = {
  visible: boolean;
};

export const getEmbeddedChatVisibilitySync = (
  frameWindow: Window | null | undefined,
): ((visibilityPayload: EmbeddedChatVisibilityPayload) => void) | null => {
  if (!frameWindow) {
    return null;
  }

  try {
    const directVisibilitySync = (frameWindow as unknown as {
      __openchamberSetEmbeddedVisibility?: unknown;
    }).__openchamberSetEmbeddedVisibility;

    return typeof directVisibilitySync === 'function'
      ? (directVisibilitySync as (visibilityPayload: EmbeddedChatVisibilityPayload) => void)
      : null;
  } catch {
    // Accessing a named property on a cross-origin frame Window can throw a
    // SecurityError. In that case callers should fall back to postMessage.
    return null;
  }
};
