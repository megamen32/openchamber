import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { applyRetryOverlay } from "../lib/turns/applyRetryOverlay";

mock.module("@/stores/useConfigStore", () => ({
  useConfigStore: (selector: (state: { providers: unknown[] }) => unknown) => selector({
    providers: [
      {
        id: "anthropic",
        models: [
          { id: "claude-sonnet-4", name: "Claude Sonnet 4", variants: { deep: {}, balanced: {} } },
        ],
      },
      {
        id: "openai",
        models: [
          { id: "gpt-5", name: "GPT-5", variants: { high: {}, low: {} } },
        ],
      },
    ],
  }),
}));

import { FailedTurnRecoveryControls } from "../FailedTurnRecoveryControls";

describe("failed message recovery ui", () => {
  test("retry overlay preserves raw provider/model/variant metadata from the failed user turn", () => {
    const messages = applyRetryOverlay([
      {
        info: {
          id: "user-1",
          role: "user",
          sessionID: "session-1",
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
          model: {
            providerID: "anthropic",
            modelID: "claude-sonnet-4",
            variant: "deep",
          },
          time: { created: 1 },
        } as never,
        parts: [],
      },
    ], {
      sessionId: "session-1",
      message: "waiting for provider",
      fallbackTimestamp: 10,
    });

    const synthetic = messages[1];
    const error = (synthetic?.info as { error?: { data?: Record<string, unknown> } } | undefined)?.error;

    expect(error?.data?.providerID).toBe("anthropic");
    expect(error?.data?.modelID).toBe("claude-sonnet-4");
    expect(error?.data?.variant).toBe("deep");
  });

  test("renders raw failure metadata, recovery buttons, and the opt-in model picker", () => {
    const collapsed = renderToStaticMarkup(
      <FailedTurnRecoveryControls
        sessionId="session-1"
        providerID="anthropic"
        modelID="claude-sonnet-4"
        variant="deep"
      />,
    );

    expect(collapsed).toContain("anthropic/claude-sonnet-4");
    expect(collapsed).toContain("deep");
    expect(collapsed).toContain("Возобновить");
    expect(collapsed).toContain("Перезапуск");
    expect(collapsed).toContain("Выбрать другую модель");

    const expanded = renderToStaticMarkup(
      <FailedTurnRecoveryControls
        sessionId="session-1"
        providerID="anthropic"
        modelID="claude-sonnet-4"
        variant="deep"
        defaultModelSwitcherOpen
      />,
    );

    expect(expanded).toContain("Использовать для следующего запроса");
    expect(expanded).toContain("name=\"provider\"");
    expect(expanded).toContain("name=\"model\"");
    expect(expanded).toContain("name=\"variant\"");
  });
});
