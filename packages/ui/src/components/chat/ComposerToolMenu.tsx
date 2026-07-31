import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/icon/Icon";
import { cn } from "@/lib/utils";
import type { CallableAction } from "@/lib/opencode/tool-call-client";
import { listCallableActions } from "@/lib/opencode/tool-call-client";

type Props = {
  sessionId: string | null;
  directory?: string | null;
  buttonClassName: string;
  iconClassName: string;
  onSelectAction: (
    action: CallableAction,
    args: Record<string, unknown>,
  ) => void;
};
type Schema = {
  properties?: Record<
    string,
    {
      title?: string;
      description?: string;
      type?: string;
      default?: unknown;
      enum?: unknown[];
    }
  >;
  required?: string[];
};
const schemaOf = (value: unknown): Schema =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Schema)
    : {};

type ComposerToolMenuContentProps = {
  actions: CallableAction[];
  loading: boolean;
  selectedActionId?: string;
  onSelectAction: (action: CallableAction) => void;
};

export function ComposerToolMenuContent({
  actions,
  loading,
  selectedActionId = "",
  onSelectAction,
}: ComposerToolMenuContentProps): React.ReactElement {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading actions…</p>;
  }

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Task or MCP actions were discovered for this session.
      </p>
    );
  }

  return (
    <label className="block text-sm font-medium">
      Action
      <select
        className="mt-1 w-full rounded-md border bg-background p-2"
        value={selectedActionId}
        onChange={(event) => {
          const action = actions.find((candidate) => candidate.id === event.target.value);
          if (action) onSelectAction(action);
        }}
      >
        <option value="">Choose an action…</option>
        {actions.map((action) => (
          <option
            key={action.id}
            value={action.id}
            disabled={!action.supported}
            data-action-kind={action.kind}
          >
            {action.label}
            {action.supported ? "" : " (Unsupported)"}
          </option>
        ))}
      </select>
      {!selectedActionId && actions.some((action) => !action.supported) ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          Unsupported actions cannot be called: {actions
            .filter((action) => !action.supported)
            .map((action) => action.unsupportedReason ?? "Unavailable")
            .filter((value, index, values) => values.indexOf(value) === index)
            .join(" ")}
        </span>
      ) : null}
    </label>
  );
}

export function ComposerToolMenu({
  sessionId,
  directory,
  buttonClassName,
  iconClassName,
  onSelectAction,
}: Props): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [actions, setActions] = React.useState<CallableAction[]>([]);
  const [selected, setSelected] = React.useState<CallableAction | null>(null);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    void listCallableActions(sessionId, directory)
      .then((a) => !cancelled && setActions(a))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, directory]);
  const fields = Object.entries(
    schemaOf(selected?.inputSchema).properties ?? {},
  );
  const hasMissingRequiredField = fields.some(([key]) =>
    schemaOf(selected?.inputSchema).required?.includes(key) &&
    (values[key] === undefined || values[key] === ""),
  );
  const choose = (id: string) => {
    const next = actions.find((a) => a.id === id) ?? null;
    setSelected(next);
    const defaults: Record<string, unknown> = {};
    for (const [key, f] of Object.entries(
      schemaOf(next?.inputSchema).properties ?? {},
    ))
      if (f.default !== undefined) defaults[key] = f.default;
    setValues(defaults);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={buttonClassName}
        disabled={!sessionId}
        title="Call Task or MCP"
        aria-label="Call Task or MCP"
        onClick={() => setOpen(true)}
      >
        <Icon name="tools" className={cn(iconClassName, "text-current")} />
      </Button>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Call Task or MCP</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ComposerToolMenuContent
            actions={actions}
            loading={loading}
            selectedActionId={selected?.id}
            onSelectAction={(action) => choose(action.id)}
          />
          {!loading &&
            selected &&
            fields.map(([key, field]) => (
                <label key={key} className="block text-sm font-medium">
                  {field.title ?? key}
                  {schemaOf(selected.inputSchema).required?.includes(key)
                    ? " *"
                    : ""}
                  {field.type === "boolean" ? (
                    <input
                      className="ml-2"
                      type="checkbox"
                      checked={Boolean(values[key])}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [key]: e.target.checked }))
                      }
                    />
                  ) : field.enum ? (
                    <select
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      value={String(values[key] ?? "")}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [key]: e.target.value }))
                      }
                    >
                      <option value="">Choose…</option>
                      {field.enum.map((value) => (
                        <option key={String(value)} value={String(value)}>
                          {String(value)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="mt-1 w-full rounded-md border bg-background p-2"
                      type={
                        field.type === "number" || field.type === "integer"
                          ? "number"
                          : "text"
                      }
                      value={String(values[key] ?? "")}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [key]:
                            field.type === "number" || field.type === "integer"
                              ? Number(e.target.value)
                              : e.target.value,
                        }))
                      }
                      placeholder={field.description}
                    />
                  )}
                </label>
            ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              !selected || !selected.supported || hasMissingRequiredField
            }
            onClick={() => {
              if (selected) {
                onSelectAction(selected, values);
                setOpen(false);
              }
            }}
          >
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export default ComposerToolMenu;
