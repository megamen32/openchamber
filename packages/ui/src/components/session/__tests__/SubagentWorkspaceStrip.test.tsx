import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  getWorkspaceStripScrollDelta,
  pickAutoOpenSubagentSession,
  reconcileKnownChildSessionIds,
} from '../subagentWorkspaceLogic';

const loadSubagentWorkspaceSettingsStoreModule = async () => (
  import('@/stores/useSubagentWorkspaceSettingsStore').catch(() => null)
);

const session = (id: string, options: { parentID?: string | null; updated?: number; directory?: string | null } = {}): Session => ({
  id,
  title: id,
  parentID: options.parentID ?? undefined,
  time: {
    created: options.updated ?? 0,
    updated: options.updated ?? 0,
  },
  directory: options.directory ?? '/workspace',
} as Session);

describe('useSubagentWorkspaceSettingsStore', () => {
  test('defaults both opt-ins to false', async () => {
    const module = await loadSubagentWorkspaceSettingsStoreModule();

    expect(module).not.toBeNull();
    expect(module?.useSubagentWorkspaceSettingsStore.getState().autoOpenSubagents).toBe(false);
    expect(module?.useSubagentWorkspaceSettingsStore.getState().horizontalSubagentChats).toBe(false);
  });
});

describe('SubagentWorkspaceStrip helpers', () => {
  test('auto-opens only brand-new direct child sessions', () => {
    const firstChildren = [
      session('child-old', { parentID: 'parent', updated: 10 }),
      session('child-new', { parentID: 'parent', updated: 20 }),
    ];

    expect(pickAutoOpenSubagentSession({
      autoOpenSubagents: false,
      activeSessionId: 'parent',
      directChildSessions: firstChildren,
      knownChildSessionIds: new Set<string>(),
    })?.id ?? null).toBe(null);

    expect(pickAutoOpenSubagentSession({
      autoOpenSubagents: true,
      activeSessionId: 'parent',
      directChildSessions: firstChildren,
      knownChildSessionIds: new Set<string>(['child-old']),
    })?.id ?? null).toBe('child-new');
  });

  test('cleans up vanished child ids before detecting a re-created child', () => {
    const knownIds = reconcileKnownChildSessionIds(
      new Set<string>(['child-a', 'child-b']),
      [session('child-b', { parentID: 'parent', updated: 5 })],
    );

    expect([...((knownIds ?? new Set<string>()))]).toEqual(['child-b']);

    expect(pickAutoOpenSubagentSession({
      autoOpenSubagents: true,
      activeSessionId: 'parent',
      directChildSessions: [
        session('child-a', { parentID: 'parent', updated: 100 }),
        session('child-b', { parentID: 'parent', updated: 50 }),
      ],
      knownChildSessionIds: knownIds ?? new Set<string>(),
    })?.id ?? null).toBe('child-a');
  });

  test('maps keyboard and trackpad input into horizontal strip scrolling', () => {
    expect(getWorkspaceStripScrollDelta({ key: 'ArrowRight' }) ?? null).toBeGreaterThan(0);
    expect(getWorkspaceStripScrollDelta({ key: 'ArrowLeft' }) ?? null).toBeLessThan(0);
    expect(getWorkspaceStripScrollDelta({ deltaX: 48, deltaY: 5 }) ?? null).toBe(48);
    expect(getWorkspaceStripScrollDelta({ deltaX: 0, deltaY: 36, shiftKey: true }) ?? null).toBe(36);
  });
});
