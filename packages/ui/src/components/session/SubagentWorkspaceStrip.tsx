import React from 'react';
import type { Message, Part, Session } from '@opencode-ai/sdk/v2';

import { useSessionUIStore } from '@/sync/session-ui-store';
import { useAllLiveSessions, useSessionMessageRecords, useSessionStatus } from '@/sync/sync-context';
import { cn, formatDirectoryName } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import { getDirectChildSessions, getWorkspaceStripScrollDelta } from './subagentWorkspaceLogic';

export {
  getDirectChildSessions,
  getWorkspaceStripScrollDelta,
  pickAutoOpenSubagentSession,
  reconcileKnownChildSessionIds,
} from './subagentWorkspaceLogic';

const getSessionDirectoryLabel = (session: Session, fallbackDirectory: string | null): string | null => {
  const directory = (session as Session & { directory?: string | null }).directory ?? fallbackDirectory ?? null;
  if (!directory) {
    return null;
  }
  return formatDirectoryName(directory);
};

const getMessageText = (parts: Part[]): string => {
  let text = '';
  for (const part of parts) {
    if (part.type !== 'text') {
      continue;
    }
    const partText = (part as Part & { text?: string }).text;
    if (typeof partText === 'string' && partText.trim().length > 0) {
      text += partText.trim();
      if (text.length >= 180) {
        break;
      }
      text += ' ';
    }
  }

  return text.trim();
};

const getLatestPreviewText = (messages: Array<{ info: Message; parts: Part[] }>): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = getMessageText(messages[index].parts);
    if (text.length > 0) {
      return text;
    }
  }
  return 'Waiting for activity…';
};

type SubagentWorkspaceStripProps = {
  anchorSessionId: string;
  activeSessionId: string | null;
  onOpenSession: (sessionId: string, directoryHint?: string | null) => void;
};

type SubagentWorkspaceCardProps = {
  session: Session;
  active: boolean;
  onOpenSession: (sessionId: string, directoryHint?: string | null) => void;
};

const SubagentWorkspaceCard: React.FC<SubagentWorkspaceCardProps> = ({ session, active, onOpenSession }) => {
  const fallbackDirectory = useSessionUIStore((state) => state.getDirectoryForSession(session.id));
  const previewDirectory = fallbackDirectory ?? (session as Session & { directory?: string | null }).directory ?? undefined;
  const messageRecords = useSessionMessageRecords(session.id, previewDirectory, { enabled: true });
  const status = useSessionStatus(session.id, previewDirectory);
  const previewText = React.useMemo(() => getLatestPreviewText(messageRecords), [messageRecords]);
  const directoryLabel = React.useMemo(() => getSessionDirectoryLabel(session, fallbackDirectory), [fallbackDirectory, session]);

  const statusLabel = status?.type === 'retry'
    ? 'Retrying'
    : status?.type === 'busy'
      ? 'Running'
      : 'Idle';

  return (
    <button
      type="button"
      onClick={() => onOpenSession(session.id, fallbackDirectory)}
      className={cn(
        'flex h-full min-w-[18rem] max-w-[22rem] flex-col rounded-xl border p-3 text-left transition-colors',
        active
          ? 'border-[var(--status-info)] bg-[color-mix(in_srgb,var(--status-info)_10%,var(--surface-background))]'
          : 'border-[var(--surface-border)] bg-[var(--surface-background)] hover:border-[var(--status-info)]/50 hover:bg-[var(--surface-background)]/95',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{session.title?.trim() || 'Subagent session'}</p>
          {directoryLabel ? (
            <p className="truncate text-xs text-muted-foreground">{directoryLabel}</p>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-background)]/80 px-2 py-1 text-[11px] text-muted-foreground">
          {status?.type === 'busy' || status?.type === 'retry' ? (
            <Icon name="loader-4" className="size-3 animate-spin" />
          ) : (
            <Icon name="chat-1" className="size-3" />
          )}
          {statusLabel}
        </span>
      </div>
      <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">{previewText}</p>
    </button>
  );
};

/**
 * Horizontally scrollable strip of direct child sessions for the current task subtree.
 */
export const SubagentWorkspaceStrip: React.FC<SubagentWorkspaceStripProps> = ({
  anchorSessionId,
  activeSessionId,
  onOpenSession,
}) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const sessions = useAllLiveSessions();
  const childSessions = React.useMemo(
    () => getDirectChildSessions(sessions, anchorSessionId),
    [anchorSessionId, sessions],
  );

  const handleScrollInput = React.useCallback((delta: number | null) => {
    if (!delta) {
      return;
    }
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.scrollLeft += delta;
  }, []);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = getWorkspaceStripScrollDelta({ key: event.key });
    if (!delta) {
      return;
    }
    event.preventDefault();
    handleScrollInput(delta);
  }, [handleScrollInput]);

  const handleWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const delta = getWorkspaceStripScrollDelta({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      shiftKey: event.shiftKey,
    });
    if (!delta) {
      return;
    }
    event.preventDefault();
    handleScrollInput(delta);
  }, [handleScrollInput]);

  if (childSessions.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-[var(--surface-border)] bg-background/95 px-3 py-3" data-subagent-workspace-strip>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subagent workspace</p>
          <p className="text-xs text-muted-foreground">Direct child sessions stay one swipe or arrow-key away.</p>
        </div>
        <span className="text-xs text-muted-foreground">{childSessions.length}</span>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        className="flex gap-3 overflow-x-auto overflow-y-hidden pb-1 outline-none"
        aria-label="Subagent workspace strip"
      >
        {childSessions.map((session) => (
          <SubagentWorkspaceCard
            key={session.id}
            session={session}
            active={activeSessionId === session.id}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>
    </section>
  );
};
