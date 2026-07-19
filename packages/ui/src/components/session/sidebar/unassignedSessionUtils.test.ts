import type { Session } from '@opencode-ai/sdk/v2';
import { describe, expect, test } from 'bun:test';
import { buildUnassignedSessionNodes } from './unassignedSessionUtils';

const session = (id: string, directory: string | null, options: Partial<Session> = {}): Session => ({
  id,
  title: id,
  directory,
  parentID: null,
  time: { created: 1, updated: 1 },
  ...options,
} as Session);

describe('buildUnassignedSessionNodes', () => {
  test('keeps unknown sessions and nests their unknown children', () => {
    const nodes = buildUnassignedSessionNodes([
      session('known', '/repo'),
      session('external-root', '/other'),
      session('external-child', '/other', { parentID: 'external-root' }),
    ], new Set(['/repo']));

    expect(nodes.map((node) => node.session.id)).toEqual(['external-root']);
    expect(nodes[0]?.children.map((node) => node.session.id)).toEqual(['external-child']);
  });

  test('does not hide an unknown child when its parent is not in the list', () => {
    const nodes = buildUnassignedSessionNodes([
      session('orphan-child', '/other', { parentID: 'missing-parent' }),
    ], new Set(['/repo']));

    expect(nodes.map((node) => node.session.id)).toEqual(['orphan-child']);
  });
});
