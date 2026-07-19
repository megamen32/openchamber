import type { Session } from '@opencode-ai/sdk/v2';
import { resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { normalizePath } from './utils';
import type { SessionNode } from './types';

const sessionUpdatedAt = (session: Session): number => {
  const updated = session.time?.updated;
  if (typeof updated === 'number' && Number.isFinite(updated)) return updated;
  const created = session.time?.created;
  return typeof created === 'number' && Number.isFinite(created) ? created : 0;
};

const compareSessions = (left: Session, right: Session): number => {
  const timeDelta = sessionUpdatedAt(right) - sessionUpdatedAt(left);
  return timeDelta !== 0 ? timeDelta : right.id.localeCompare(left.id);
};

const isKnownDirectory = (session: Session, knownDirectories: Set<string>): boolean => {
  const directory = normalizePath(resolveGlobalSessionDirectory(session));
  return directory ? knownDirectories.has(directory.toLowerCase()) : false;
};

/**
 * Build a tree for sessions that do not belong to a registered project.
 *
 * Unknown sessions are intentionally kept separate from project grouping: a
 * missing project record is not enough evidence to assign a session to an
 * arbitrary project. Children whose parent is absent are promoted to roots so
 * every session remains reachable from the UI.
 */
export const buildUnassignedSessionNodes = (
  sessions: Session[],
  knownDirectories: Set<string>,
): SessionNode[] => {
  const unique = new Map<string, Session>();
  for (const session of sessions) {
    if (!session?.id || isKnownDirectory(session, knownDirectories)) continue;
    unique.set(session.id, session);
  }

  const childrenByParent = new Map<string, Session[]>();
  for (const current of unique.values()) {
    const parentID = (current as Session & { parentID?: string | null }).parentID;
    if (!parentID || !unique.has(parentID)) continue;
    const children = childrenByParent.get(parentID) ?? [];
    children.push(current);
    childrenByParent.set(parentID, children);
  }

  const buildNode = (current: Session): SessionNode => ({
    session: current,
    children: (childrenByParent.get(current.id) ?? [])
      .sort(compareSessions)
      .map(buildNode),
    worktree: null,
  });

  return [...unique.values()]
    .filter((current) => {
      const parentID = (current as Session & { parentID?: string | null }).parentID;
      return !parentID || !unique.has(parentID);
    })
    .sort(compareSessions)
    .map(buildNode);
};
