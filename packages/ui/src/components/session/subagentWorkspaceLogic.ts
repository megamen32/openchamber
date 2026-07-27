import type { Session } from '@opencode-ai/sdk/v2';

const WORKSPACE_STRIP_KEYBOARD_SCROLL_STEP = 320;

type WorkspaceStripScrollInput = {
  key?: string;
  deltaX?: number;
  deltaY?: number;
  shiftKey?: boolean;
};

type PickAutoOpenSubagentSessionInput = {
  autoOpenSubagents: boolean;
  activeSessionId: string | null;
  directChildSessions: Session[];
  knownChildSessionIds: Set<string>;
};

const getSessionUpdatedAt = (session: Session): number => {
  const updatedAt = session.time?.updated;
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = session.time?.created;
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0;
};

const compareSessionsByRecency = (left: Session, right: Session): number => {
  const delta = getSessionUpdatedAt(right) - getSessionUpdatedAt(left);
  return delta !== 0 ? delta : left.id.localeCompare(right.id);
};

export const getDirectChildSessions = (sessions: Session[], parentSessionId: string | null): Session[] => {
  if (!parentSessionId) return [];
  return sessions
    .filter((session) => (session as Session & { parentID?: string | null }).parentID === parentSessionId)
    .sort(compareSessionsByRecency);
};

export const reconcileKnownChildSessionIds = (
  knownChildSessionIds: Iterable<string>,
  directChildSessions: Session[],
): Set<string> => {
  const liveIds = new Set(directChildSessions.map((session) => session.id));
  return new Set([...knownChildSessionIds].filter((sessionId) => liveIds.has(sessionId)));
};

export const pickAutoOpenSubagentSession = ({
  autoOpenSubagents,
  activeSessionId,
  directChildSessions,
  knownChildSessionIds,
}: PickAutoOpenSubagentSessionInput): Session | null => {
  if (!autoOpenSubagents || !activeSessionId) return null;
  return directChildSessions.find((session) => !knownChildSessionIds.has(session.id)) ?? null;
};

export const getWorkspaceStripScrollDelta = (input: WorkspaceStripScrollInput): number | null => {
  if (input.key === 'ArrowRight') return WORKSPACE_STRIP_KEYBOARD_SCROLL_STEP;
  if (input.key === 'ArrowLeft') return -WORKSPACE_STRIP_KEYBOARD_SCROLL_STEP;
  const deltaX = typeof input.deltaX === 'number' ? input.deltaX : 0;
  const deltaY = typeof input.deltaY === 'number' ? input.deltaY : 0;
  if (deltaX !== 0) return deltaX;
  if (input.shiftKey && deltaY !== 0) return deltaY;
  return null;
};
