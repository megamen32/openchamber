import { describe, expect, test } from 'bun:test';

import { getEmbeddedChatVisibilitySync } from './contextPanelEmbeddedVisibility';

describe('getEmbeddedChatVisibilitySync', () => {
  test('returns direct visibility sync for same-origin embedded chat windows', () => {
    const sync = () => {};
    const frameWindow = {
      __openchamberSetEmbeddedVisibility: sync,
    } as unknown as Window;

    expect(getEmbeddedChatVisibilitySync(frameWindow)).toBe(sync);
  });

  test('returns null instead of throwing when a cross-origin frame blocks named property access', () => {
    const frameWindow = Object.create(null);
    Object.defineProperty(frameWindow, '__openchamberSetEmbeddedVisibility', {
      get() {
        throw new DOMException(
          'Blocked a frame with origin from accessing a cross-origin frame.',
          'SecurityError',
        );
      },
    });

    expect(getEmbeddedChatVisibilitySync(frameWindow as Window)).toBeNull();
  });
});
