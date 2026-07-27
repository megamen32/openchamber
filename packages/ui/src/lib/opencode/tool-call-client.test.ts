import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Agent, Message, Part, Session } from '@opencode-ai/sdk/v2/client';

let agentControlToolEnabled = true;
let listedAgents: Agent[] = [];
let mcpStatusByName: Record<string, { status?: string }> = {};
let sessionsById: Record<string, Session> = {};
let messagesBySessionId: Record<string, Array<{ info: Message; parts: Part[] }>> = {};
const sendPlainSessionMessageCalls: Array<{ sessionID: string; directory: string; text: string }> = [];

mock.module('@/stores/useUIStore', () => ({
  useUIStore: {
    getState: () => ({ agentControlToolEnabled }),
  },
}));

mock.module('@/stores/useMcpStore', () => ({
  useMcpStore: {
    getState: () => ({
      getStatusForDirectory: () => mcpStatusByName,
    }),
  },
  listDiscoveredMcpEntries: (status: Record<string, { status?: string }>) => Object.entries(status)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      id: `mcp:${name}`,
      label: `MCP: ${name}`,
      name,
      status: value.status ?? 'unknown',
      statusLabel: value.status ?? 'unknown',
    })),
}));

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    listAgents: mock(async () => listedAgents),
    getSession: mock(async (sessionID: string) => {
      const session = sessionsById[sessionID];
      if (!session) throw new Error(`Unknown session: ${sessionID}`);
      return session;
    }),
    getSessionMessages: mock(async (sessionID: string) => messagesBySessionId[sessionID] ?? []),
  },
}));

mock.module('@/sync/session-actions', () => ({
  sendPlainSessionMessage: mock(async (sessionID: string, directory: string, text: string) => {
    sendPlainSessionMessageCalls.push({ sessionID, directory, text });
    return 'msg_parent_handoff';
  }),
}));

const {
  DIRECT_ACTION_UNSUPPORTED_MESSAGE,
  callAction,
  listCallableActions,
  sendLastChildAnswerToParent,
} = await import('./tool-call-client');

describe('tool-call-client', () => {
  beforeEach(() => {
    agentControlToolEnabled = true;
    listedAgents = [];
    mcpStatusByName = {};
    sessionsById = {};
    messagesBySessionId = {};
    sendPlainSessionMessageCalls.length = 0;
  });

  test('lists runtime-proven Task and MCP discovery entries as visibly unsupported actions', async () => {
    listedAgents = [
      { name: 'planner', mode: 'subagent' } as Agent,
      { name: 'reviewer', mode: 'all' } as Agent,
      { name: 'primary-only', mode: 'primary' } as Agent,
      { name: 'hidden-helper', mode: 'subagent', hidden: true } as Agent,
    ];
    mcpStatusByName = {
      github: { status: 'connected' },
      slack: { status: 'needs_auth' },
    };

    const actions = await listCallableActions('session-child', '/repo/app');

    expect(actions).toEqual([
      {
        kind: 'task',
        id: 'task:planner',
        label: 'Task: planner',
        supported: false,
        unsupportedReason: DIRECT_ACTION_UNSUPPORTED_MESSAGE,
      },
      {
        kind: 'task',
        id: 'task:reviewer',
        label: 'Task: reviewer',
        supported: false,
        unsupportedReason: DIRECT_ACTION_UNSUPPORTED_MESSAGE,
      },
      {
        kind: 'mcp',
        id: 'mcp:github',
        label: 'MCP: github',
        statusLabel: 'connected',
        supported: false,
        unsupportedReason: DIRECT_ACTION_UNSUPPORTED_MESSAGE,
      },
      {
        kind: 'mcp',
        id: 'mcp:slack',
        label: 'MCP: slack',
        statusLabel: 'needs_auth',
        supported: false,
        unsupportedReason: DIRECT_ACTION_UNSUPPORTED_MESSAGE,
      },
    ]);
  });

  test('rejects discovered direct actions when the runtime lacks a safe invocation contract', async () => {
    listedAgents = [{ name: 'planner', mode: 'subagent' } as Agent];

    await expect(callAction({
      sessionId: 'session-child',
      actionId: 'task:planner',
      arguments: { brief: 'Investigate' },
      directory: '/repo/app',
    })).rejects.toThrow(DIRECT_ACTION_UNSUPPORTED_MESSAGE);
  });

  test('sends the latest completed child assistant answer to the native parent session', async () => {
    sessionsById = {
      'session-child': { id: 'session-child', parentID: 'session-parent' } as Session,
    };
    messagesBySessionId = {
      'session-child': [
        {
          info: { id: 'msg_user', role: 'user', time: { created: 1, completed: 1 } } as unknown as Message,
          parts: [{ id: 'prt_user', type: 'text', text: 'question' } as Part],
        },
        {
          info: { id: 'msg_answer_1', role: 'assistant', finish: 'stop', time: { created: 2, completed: 3 } } as unknown as Message,
          parts: [{ id: 'prt_answer_1', type: 'text', text: 'first answer' } as Part],
        },
        {
          info: { id: 'msg_streaming', role: 'assistant', time: { created: 4, completed: 0 } } as unknown as Message,
          parts: [{ id: 'prt_streaming', type: 'text', text: 'still streaming' } as Part],
        },
        {
          info: { id: 'msg_answer_2', role: 'assistant', finish: 'stop', time: { created: 5, completed: 6 } } as unknown as Message,
          parts: [{ id: 'prt_answer_2', type: 'text', text: 'latest completed answer' } as Part],
        },
      ],
    };

    await sendLastChildAnswerToParent('session-child', '/repo/app');

    expect(sendPlainSessionMessageCalls).toEqual([
      {
        sessionID: 'session-parent',
        directory: '/repo/app',
        text: 'latest completed answer',
      },
    ]);
  });

  test('fails parent handoff when the child session has no native parent', async () => {
    sessionsById = {
      orphan: { id: 'orphan', parentID: '' } as Session,
    };

    await expect(sendLastChildAnswerToParent('orphan', '/repo/app')).rejects.toThrow('parent');
  });
});
