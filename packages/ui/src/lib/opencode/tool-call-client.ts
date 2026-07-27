import type { Agent, Message } from '@opencode-ai/sdk/v2/client';

import { flattenAssistantTextParts } from '@/lib/messages/messageText';
import { opencodeClient } from '@/lib/opencode/client';
import { useMcpStore, listDiscoveredMcpEntries } from '@/stores/useMcpStore';
import { useUIStore } from '@/stores/useUIStore';
import { sendPlainSessionMessage } from '@/sync/session-actions';

export const DIRECT_ACTION_UNSUPPORTED_MESSAGE = 'Direct Task/MCP invocation is not exposed by the current OpenCode runtime.';

export type CallableAction = {
  kind: 'task' | 'mcp';
  id: string;
  label: string;
  inputSchema?: unknown;
  supported: boolean;
  unsupportedReason?: string;
  statusLabel?: string;
};

type AgentWithVisibility = Agent & {
  hidden?: boolean;
  options?: { hidden?: boolean };
  mode?: 'primary' | 'subagent' | 'all' | string;
};

const isActionablyVisibleTaskAgent = (agent: Agent): boolean => {
  const candidate = agent as AgentWithVisibility;
  const isHidden = candidate.hidden === true || candidate.options?.hidden === true;
  if (isHidden) return false;
  return candidate.mode === 'subagent' || candidate.mode === 'all';
};

const toTaskAction = (agent: Agent): CallableAction => ({
  kind: 'task',
  id: `task:${agent.name}`,
  label: `task:${agent.name}`,
  supported: true,
  statusLabel: 'Available',
});

const isMessageCompleted = (message: Message): boolean => {
  const finish = (message as { finish?: unknown }).finish;
  if (typeof finish === 'string' && finish.length > 0) return true;
  const completed = (message as { time?: { completed?: unknown } }).time?.completed;
  return typeof completed === 'number' && completed > 0;
};

const getMessageCreatedAt = (message: Message): number => {
  const created = (message as { time?: { created?: unknown } }).time?.created;
  return typeof created === 'number' && Number.isFinite(created) ? created : 0;
};

const getLatestCompletedAssistantText = (
  messages: Array<{ info: Message; parts: unknown[] }>,
): string | null => {
  const assistantMessages = messages
    .filter((entry) => entry.info.role === 'assistant')
    .filter((entry) => isMessageCompleted(entry.info))
    .sort((left, right) => getMessageCreatedAt(right.info) - getMessageCreatedAt(left.info));

  for (const entry of assistantMessages) {
    const text = flattenAssistantTextParts(entry.parts as Parameters<typeof flattenAssistantTextParts>[0]).trim();
    if (text) return text;
  }

  return null;
};

const getDiscoveredTaskActions = async (directory?: string | null): Promise<CallableAction[]> => {
  if (!useUIStore.getState().agentControlToolEnabled) {
    return [];
  }

  try {
    const agents = await opencodeClient.listAgents(directory);
    return agents
      .filter(isActionablyVisibleTaskAgent)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(toTaskAction);
  } catch {
    return [];
  }
};

export async function listCallableActions(sessionId: string, directory?: string | null): Promise<CallableAction[]> {
  void sessionId;
  const [taskActions, toolIds] = await Promise.all([
    getDiscoveredTaskActions(directory),
    opencodeClient.listExperimentalToolIds(directory).catch(() => []),
  ]);

  if (toolIds.length > 0) {
    return [
      ...taskActions,
      ...toolIds
        .filter((id) => id !== 'task')
        .map((id) => ({
          kind: 'mcp' as const,
          id: `mcp:${id}`,
          label: `mcp:${id}`,
          supported: true,
          statusLabel: 'Available',
        })),
    ];
  }

  const mcpEntries = listDiscoveredMcpEntries(useMcpStore.getState().getStatusForDirectory(directory));

  return [
    ...taskActions,
    ...mcpEntries.map((entry) => ({
      kind: 'mcp' as const,
      id: entry.id,
      label: entry.label,
      statusLabel: entry.statusLabel,
      supported: false,
      unsupportedReason: DIRECT_ACTION_UNSUPPORTED_MESSAGE,
    })),
  ];
}

export async function callAction(input: {
  sessionId: string;
  actionId: string;
  arguments: Record<string, unknown>;
  directory?: string;
}): Promise<void> {
  if (!input.actionId.trim()) {
    throw new Error('Action ID is required');
  }
  if (!input.arguments || Array.isArray(input.arguments)) {
    throw new Error('Action arguments must be an object');
  }

  const actions = await listCallableActions(input.sessionId, input.directory);
  const action = actions.find((candidate) => candidate.id === input.actionId);
  if (!action) {
    throw new Error(`Unknown action: ${input.actionId}`);
  }
  if (!action.supported) {
    throw new Error(action.unsupportedReason ?? DIRECT_ACTION_UNSUPPORTED_MESSAGE);
  }

  const tool = action.kind === 'task' ? 'task' : action.id.slice('mcp:'.length);
  const argumentsForCall = action.kind === 'task'
    ? {
      ...input.arguments,
      description: typeof input.arguments.description === 'string' ? input.arguments.description : action.label,
      subagent_type: action.id.slice('task:'.length),
    }
    : input.arguments;
  await opencodeClient.callExperimentalTool({
    sessionId: input.sessionId,
    tool,
    arguments: argumentsForCall,
    directory: input.directory,
  });
}

export async function sendLastChildAnswerToParent(childSessionId: string, directory?: string | null): Promise<void> {
  const childSession = await opencodeClient.getSession(childSessionId, directory);
  const parentID = typeof (childSession as { parentID?: unknown }).parentID === 'string'
    ? (childSession as { parentID: string }).parentID.trim()
    : '';
  if (!parentID) {
    throw new Error('This child session does not have a native parent session to receive a handoff');
  }

  const messages = await opencodeClient.getSessionMessages(childSessionId, undefined, directory);
  const latestAssistantText = getLatestCompletedAssistantText(messages);
  if (!latestAssistantText) {
    throw new Error('No completed assistant answer is available to hand off to the parent session');
  }

  const targetDirectory = directory?.trim();
  if (!targetDirectory) {
    throw new Error('A directory is required to hand the child answer back to the parent session');
  }

  await sendPlainSessionMessage(parentID, targetDirectory, latestAssistantText);
}
