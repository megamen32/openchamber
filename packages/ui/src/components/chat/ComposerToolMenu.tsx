import React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import type { CallableAction } from '@/lib/opencode/tool-call-client';
import { listCallableActions } from '@/lib/opencode/tool-call-client';

type ComposerToolMenuContentProps = {
  actions: CallableAction[];
  loading: boolean;
  onSelectAction: (action: CallableAction) => void;
};

export function ComposerToolMenuContent({
  actions,
  loading,
  onSelectAction,
}: ComposerToolMenuContentProps): React.ReactElement {
  if (loading) {
    return (
      <div className="min-w-[20rem] px-3 py-2 text-sm text-muted-foreground">
        Loading Task and MCP actions…
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div className="min-w-[20rem] px-3 py-2 text-sm text-muted-foreground">
        No Task or MCP actions were discovered for this session.
      </div>
    );
  }

  return (
    <div className="min-w-[22rem] py-1">
      {actions.map((action) => (
        <DropdownMenuItem
          key={action.id}
          className="items-start"
          onSelect={() => onSelectAction(action)}
        >
          <div className="flex w-full flex-col gap-1" data-action-kind={action.kind}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground">{action.label}</span>
              {!action.supported ? (
                <span className="rounded-full border border-border/80 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Unsupported
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {action.supported
                ? (action.statusLabel ?? 'Available')
                : (action.unsupportedReason ?? action.statusLabel ?? 'Unavailable')}
            </div>
          </div>
        </DropdownMenuItem>
      ))}
    </div>
  );
}

type ComposerToolMenuProps = {
  sessionId: string | null;
  directory?: string | null;
  buttonClassName: string;
  iconClassName: string;
  onSelectAction: (action: CallableAction) => void;
};

export function ComposerToolMenu({
  sessionId,
  directory,
  buttonClassName,
  iconClassName,
  onSelectAction,
}: ComposerToolMenuProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [actions, setActions] = React.useState<CallableAction[]>([]);

  React.useEffect(() => {
    if (!open || !sessionId) return;

    let cancelled = false;
    setLoading(true);
    void listCallableActions(sessionId, directory)
      .then((nextActions) => {
        if (!cancelled) {
          setActions(nextActions);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [directory, open, sessionId]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={buttonClassName}
          disabled={!sessionId}
          title="Task and MCP actions"
          aria-label="Task and MCP actions"
        >
          <Icon name="tools" className={cn(iconClassName, 'text-current')} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <ComposerToolMenuContent
          actions={actions}
          loading={loading}
          onSelectAction={onSelectAction}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ComposerToolMenu;
