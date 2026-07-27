import { beforeEach, describe, expect, mock, test } from "bun:test";

type PromptCall = {
  sessionId: string;
  directory?: string | null;
  id?: string;
  resume?: boolean;
  prompt: {
    text: string;
    files?: Array<{ uri: string; name?: string }>;
    agents?: Array<{ name: string }>;
  };
};

const operationLog: Array<Record<string, unknown>> = [];
const sessionMessages: Array<Record<string, unknown>> = [];
const sessionParts = new Map<string, Array<Record<string, unknown>>>();
const savedSelections: Array<Record<string, unknown>> = [];
let promptImpl: (params: PromptCall) => Promise<void> = async () => undefined;

const selectionState = {
  saveSessionModelSelection: (sessionId: string, providerId: string, modelId: string) => {
    savedSelections.push({ kind: "session", sessionId, providerId, modelId });
  },
  saveAgentModelForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => {
    savedSelections.push({ kind: "agent-model", sessionId, agentName, providerId, modelId });
  },
  saveAgentModelVariantForSession: (
    sessionId: string,
    agentName: string,
    providerId: string,
    modelId: string,
    variant: string | undefined,
  ) => {
    savedSelections.push({ kind: "agent-variant", sessionId, agentName, providerId, modelId, variant });
  },
  getSessionAgentSelection: () => "planner",
};

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    setDirectory: () => undefined,
    getDirectory: () => undefined,
    waitForSessionIdle: async (sessionId: string, directory?: string | null) => {
      operationLog.push({ kind: "wait", sessionId, directory });
    },
    abortSession: async (sessionId: string, directory?: string | null) => {
      operationLog.push({ kind: "abort", sessionId, directory });
      return true;
    },
    promptSession: async (params: PromptCall) => {
      operationLog.push({ kind: "prompt", ...params });
      await promptImpl(params);
    },
    switchSessionModel: async (
      sessionId: string,
      selection: { providerID: string; modelID: string; variant?: string },
      directory?: string | null,
    ) => {
      operationLog.push({ kind: "switch-model", sessionId, selection, directory });
    },
    createMessageId: () => "msg_recovery_001",
  },
}));

mock.module("./sync-refs", () => ({
  getSyncMessages: () => sessionMessages,
  getSyncParts: (messageId: string) => sessionParts.get(messageId) ?? [],
}));

mock.module("./session-ui-store", () => ({
  useSessionUIStore: {
    getState: () => ({
      getDirectoryForSession: () => "/repo/openchamber",
    }),
  },
}));

mock.module("./selection-store", () => ({
  useSelectionStore: {
    getState: () => selectionState,
  },
}));

mock.module("./input-store", () => ({
  useInputStore: {
    getState: () => ({
      pendingInputText: null,
      attachedFiles: [],
      setPendingInputText: () => undefined,
      setAttachedFiles: () => undefined,
    }),
  },
}));

import { recoverFailedTurn, switchModelForNextRequest } from "./session-recovery-actions";

const seedFailedTurn = (): void => {
  sessionMessages.length = 0;
  sessionParts.clear();

  sessionMessages.push(
    {
      id: "assistant-0",
      role: "assistant",
      sessionID: "session-1",
      time: { created: 1, completed: 2 },
    },
    {
      id: "user-1",
      role: "user",
      sessionID: "session-1",
      agent: "planner",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "deep",
      },
      time: { created: 3 },
    },
  );

  sessionParts.set("user-1", [
    { id: "part-text", type: "text", text: "Retry this exact request", synthetic: false },
    { id: "part-file", type: "file", url: "file:///repo/openchamber/notes.md", filename: "notes.md", synthetic: false },
    { id: "part-agent", type: "agent", name: "reviewer" },
  ]);
};

describe("session-recovery-actions", () => {
  beforeEach(() => {
    operationLog.length = 0;
    savedSelections.length = 0;
    promptImpl = async () => undefined;
    seedFailedTurn();
  });

  test("resume waits for idle and replays the last user prompt through durable session.prompt", async () => {
    await recoverFailedTurn({ sessionId: "session-1", mode: "resume" });

    expect(operationLog).toEqual([
      {
        kind: "wait",
        sessionId: "session-1",
        directory: "/repo/openchamber",
      },
      {
        kind: "switch-model",
        sessionId: "session-1",
        selection: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "deep" },
        directory: "/repo/openchamber",
      },
      {
        kind: "prompt",
        sessionId: "session-1",
        directory: "/repo/openchamber",
        resume: true,
        prompt: {
          text: "Retry this exact request",
          files: [{ uri: "file:///repo/openchamber/notes.md", name: "notes.md" }],
          agents: [{ name: "reviewer" }],
        },
      },
    ]);
  });

  test("restart aborts stale work, waits for idle, and uses an explicit generated message id", async () => {
    await recoverFailedTurn({
      sessionId: "session-1",
      mode: "restart",
      providerID: "openai",
      modelID: "gpt-5",
      variant: "high",
    });

    expect(operationLog).toEqual([
      {
        kind: "abort",
        sessionId: "session-1",
        directory: "/repo/openchamber",
      },
      {
        kind: "wait",
        sessionId: "session-1",
        directory: "/repo/openchamber",
      },
      {
        kind: "switch-model",
        sessionId: "session-1",
        selection: { providerID: "openai", modelID: "gpt-5", variant: "high" },
        directory: "/repo/openchamber",
      },
      {
        kind: "prompt",
        sessionId: "session-1",
        directory: "/repo/openchamber",
        id: "msg_recovery_001",
        resume: true,
        prompt: {
          text: "Retry this exact request",
          files: [{ uri: "file:///repo/openchamber/notes.md", name: "notes.md" }],
          agents: [{ name: "reviewer" }],
        },
      },
    ]);
  });

  test("switchModelForNextRequest uses session.switchModel and updates persisted selections", async () => {
    await switchModelForNextRequest("session-1", {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "high",
    });

    expect(operationLog).toEqual([
      {
        kind: "switch-model",
        sessionId: "session-1",
        selection: { providerID: "openai", modelID: "gpt-5", variant: "high" },
        directory: "/repo/openchamber",
      },
    ]);
    expect(savedSelections).toEqual([
      { kind: "session", sessionId: "session-1", providerId: "openai", modelId: "gpt-5" },
      { kind: "agent-model", sessionId: "session-1", agentName: "planner", providerId: "openai", modelId: "gpt-5" },
      {
        kind: "agent-variant",
        sessionId: "session-1",
        agentName: "planner",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
      },
    ]);
  });

  test("deduplicates concurrent recovery requests for the same session", async () => {
    const promptGate: { release?: () => void } = {};
    promptImpl = () => new Promise<void>((resolve) => {
      promptGate.release = resolve;
    });

    const first = recoverFailedTurn({ sessionId: "session-1", mode: "resume" });
    const second = recoverFailedTurn({ sessionId: "session-1", mode: "resume" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(operationLog.filter((entry) => entry.kind === "prompt")).toHaveLength(1);

    if (promptGate.release) {
      promptGate.release();
    }
    await Promise.all([first, second]);
  });
});
