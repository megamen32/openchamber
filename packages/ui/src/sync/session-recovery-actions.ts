import { isSyntheticPart } from "@/lib/messages/synthetic";
import { opencodeClient } from "@/lib/opencode/client";

import { useInputStore } from "./input-store";
import { useSelectionStore } from "./selection-store";
import { getSyncMessages, getSyncParts } from "./sync-refs";
import { useSessionUIStore } from "./session-ui-store";

export type ModelSelection = {
  providerID: string;
  modelID: string;
  variant?: string;
};

type RecoverFailedTurnInput = {
  sessionId: string;
  mode: "resume" | "restart";
  providerID?: string;
  modelID?: string;
  variant?: string;
};

type RecoveryFileAttachment = {
  uri: string;
  name?: string;
  mimeType?: string;
};

type RecoverableTurn = {
  prompt: {
    text: string;
    files?: RecoveryFileAttachment[];
    agents?: Array<{ name: string }>;
  };
  selection?: ModelSelection;
};

const recoveryInFlight = new Map<string, Promise<void>>();

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getRecoveryDirectory = (sessionId: string): string | undefined => {
  return useSessionUIStore.getState().getDirectoryForSession(sessionId) ?? undefined;
};

const readLastUserMessage = (sessionId: string, directory?: string): Record<string, unknown> => {
  const messages = getSyncMessages(sessionId, directory) as Array<Record<string, unknown>>;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }
  throw new Error(`No user turn available to recover for ${sessionId}`);
};

const readRecoverableTurn = (sessionId: string, directory?: string): RecoverableTurn => {
  const message = readLastUserMessage(sessionId, directory);
  const messageId = normalizeString(message.id);
  const parts = messageId ? getSyncParts(messageId, directory) as Array<Record<string, unknown>> : [];

  const textParts = parts
    .filter((part) => part.type === "text" && !isSyntheticPart(part as never))
    .map((part) => normalizeString(part.text) ?? normalizeString(part.content) ?? "")
    .filter((part) => part.length > 0);
  const promptText = textParts.join("\n").trim() || normalizeString(message.text) || "";

  const files = parts
    .filter((part) => part.type === "file" && !isSyntheticPart(part as never))
    .map((part) => ({
      uri: normalizeString(part.url) ?? "",
      name: normalizeString(part.filename),
      mimeType: normalizeString(part.mime),
    }))
    .filter((file) => file.uri.length > 0);

  const agents = parts
    .filter((part) => part.type === "agent")
    .map((part) => normalizeString(part.name))
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name }));

  if (!promptText && files.length === 0 && agents.length === 0) {
    throw new Error(`The last user turn in ${sessionId} has no recoverable prompt content`);
  }

  const providerID = normalizeString((message.model as { providerID?: unknown } | undefined)?.providerID)
    ?? normalizeString(message.providerID);
  const modelID = normalizeString((message.model as { modelID?: unknown } | undefined)?.modelID)
    ?? normalizeString(message.modelID);
  const messageVariant = normalizeString((message.model as { variant?: unknown } | undefined)?.variant)
    ?? normalizeString(message.variant);

  return {
    prompt: {
      text: promptText,
      ...(files.length > 0 ? { files } : {}),
      ...(agents.length > 0 ? { agents } : {}),
    },
    selection: providerID && modelID ? { providerID, modelID, ...(messageVariant ? { variant: messageVariant } : {}) } : undefined,
  };
};

const resolveRecoverySelection = (
  input: RecoverFailedTurnInput,
  fallback: ModelSelection | undefined,
): ModelSelection | undefined => {
  const providerID = normalizeString(input.providerID) ?? fallback?.providerID;
  const modelID = normalizeString(input.modelID) ?? fallback?.modelID;
  if (!providerID || !modelID) {
    return undefined;
  }
  const variant = normalizeString(input.variant) ?? fallback?.variant;
  return { providerID, modelID, ...(variant ? { variant } : {}) };
};

const readAgentName = (sessionId: string): string | undefined => {
  const selection = useSelectionStore.getState().getSessionAgentSelection(sessionId);
  if (selection) {
    return selection;
  }
  const lastChoice = useSessionUIStore.getState().getLastUserChoice(sessionId);
  return normalizeString(lastChoice?.agent);
};

export const restoreFailedTurnInput = (sessionId: string): void => {
  const directory = getRecoveryDirectory(sessionId);
  const recoverableTurn = readRecoverableTurn(sessionId, directory);
  const inputStore = useInputStore.getState();

  if ((!inputStore.pendingInputText || inputStore.pendingInputText.trim().length === 0) && recoverableTurn.prompt.text) {
    inputStore.setPendingInputText(recoverableTurn.prompt.text, "replace");
  }

  if ((inputStore.attachedFiles?.length ?? 0) > 0) {
    return;
  }

  const recoverableFiles = recoverableTurn.prompt.files ?? [];
  if (recoverableFiles.length === 0) {
    return;
  }

  inputStore.clearAttachedFiles?.();
  for (const file of recoverableFiles) {
    inputStore.addRestoredAttachment?.({
      url: file.uri,
      mimeType: file.mimeType ?? "application/octet-stream",
      filename: file.name ?? "attachment",
    });
  }
};

export const switchModelForNextRequest = async (sessionId: string, selection: ModelSelection): Promise<void> => {
  if (!normalizeString(selection.providerID) || !normalizeString(selection.modelID)) {
    throw new Error("A providerID/modelID pair is required to switch the next request model");
  }

  const directory = getRecoveryDirectory(sessionId);
  await opencodeClient.switchSessionModel(sessionId, selection, directory);

  const selectionStore = useSelectionStore.getState();
  selectionStore.saveSessionModelSelection(sessionId, selection.providerID, selection.modelID);

  const agentName = readAgentName(sessionId);
  if (agentName) {
    selectionStore.saveAgentModelForSession(sessionId, agentName, selection.providerID, selection.modelID);
    selectionStore.saveAgentModelVariantForSession(
      sessionId,
      agentName,
      selection.providerID,
      selection.modelID,
      selection.variant,
    );
  }
};

export const recoverFailedTurn = async (input: RecoverFailedTurnInput): Promise<void> => {
  const existing = recoveryInFlight.get(input.sessionId);
  if (existing) {
    return existing;
  }

  const execution = (async () => {
    const directory = getRecoveryDirectory(input.sessionId);
    const recoverableTurn = readRecoverableTurn(input.sessionId, directory);
    const selection = resolveRecoverySelection(input, recoverableTurn.selection);

    restoreFailedTurnInput(input.sessionId);

    if (input.mode === "restart") {
      await opencodeClient.abortSession(input.sessionId, directory);
    }

    await opencodeClient.waitForSessionIdle(input.sessionId, directory);

    if (selection) {
      await switchModelForNextRequest(input.sessionId, selection);
    }

    await opencodeClient.promptSession({
      sessionId: input.sessionId,
      directory,
      ...(input.mode === "restart" ? { id: opencodeClient.createMessageId() } : {}),
      resume: true,
      prompt: recoverableTurn.prompt,
    });
  })().finally(() => {
    recoveryInFlight.delete(input.sessionId);
  });

  recoveryInFlight.set(input.sessionId, execution);
  return execution;
};
