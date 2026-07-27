import React from "react";

import { Button } from "@/components/ui/button";
import { useConfigStore } from "@/stores/useConfigStore";
import {
  recoverFailedTurn,
  restoreFailedTurnInput,
  switchModelForNextRequest,
  type ModelSelection,
} from "@/sync/session-recovery-actions";

type RecoveryProvider = {
  id: string;
  models?: Array<{
    id: string;
    variants?: Record<string, unknown>;
  }>;
};

export type FailedTurnRecoveryControlsProps = {
  sessionId: string;
  providerID?: string;
  modelID?: string;
  variant?: string;
  actualModel?: string;
  fallbackUsed?: boolean;
  defaultModelSwitcherOpen?: boolean;
};

const normalizeValue = (value: string | undefined): string => value?.trim() ?? "";

export const FailedTurnRecoveryControls: React.FC<FailedTurnRecoveryControlsProps> = ({
  sessionId,
  providerID,
  modelID,
  variant,
  actualModel,
  fallbackUsed,
  defaultModelSwitcherOpen = false,
}) => {
  const providers = useConfigStore((state) => state.providers as RecoveryProvider[]);
  const [modelSwitcherOpen, setModelSwitcherOpen] = React.useState(defaultModelSwitcherOpen);
  const [selectedProviderID, setSelectedProviderID] = React.useState(normalizeValue(providerID));
  const [selectedModelID, setSelectedModelID] = React.useState(normalizeValue(modelID));
  const [selectedVariant, setSelectedVariant] = React.useState(normalizeValue(variant));
  const [pendingAction, setPendingAction] = React.useState<"resume" | "restart" | "switch" | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    restoreFailedTurnInput(sessionId);
  }, [sessionId]);

  const selectedProvider = React.useMemo(
    () => providers.find((provider) => provider.id === selectedProviderID),
    [providers, selectedProviderID],
  );
  const selectedModel = React.useMemo(
    () => selectedProvider?.models?.find((model) => model.id === selectedModelID),
    [selectedModelID, selectedProvider],
  );
  const variantOptions = React.useMemo(
    () => (selectedModel?.variants ? Object.keys(selectedModel.variants) : []),
    [selectedModel],
  );

  React.useEffect(() => {
    if (selectedProviderID && !selectedProvider) {
      setSelectedProviderID("");
      setSelectedModelID("");
      setSelectedVariant("");
      return;
    }
    if (selectedModelID && !selectedModel) {
      setSelectedModelID("");
      setSelectedVariant("");
      return;
    }
    if (selectedVariant && !variantOptions.includes(selectedVariant)) {
      setSelectedVariant("");
    }
  }, [selectedModel, selectedModelID, selectedProvider, selectedProviderID, selectedVariant, variantOptions]);

  const selection = React.useMemo<ModelSelection | undefined>(() => {
    if (!selectedProviderID || !selectedModelID) {
      return undefined;
    }
    return {
      providerID: selectedProviderID,
      modelID: selectedModelID,
      variant: selectedVariant || undefined,
    };
  }, [selectedModelID, selectedProviderID, selectedVariant]);

  const handleRecover = React.useCallback(async (mode: "resume" | "restart") => {
    setPendingAction(mode);
    setActionError(null);
    try {
      await recoverFailedTurn({
        sessionId,
        mode,
        providerID: selection?.providerID,
        modelID: selection?.modelID,
        variant: selection?.variant,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error ?? ""));
    } finally {
      setPendingAction(null);
    }
  }, [selection, sessionId]);

  const handleSwitchModel = React.useCallback(async () => {
    if (!selection) {
      return;
    }
    setPendingAction("switch");
    setActionError(null);
    try {
      await switchModelForNextRequest(sessionId, selection);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error ?? ""));
    } finally {
      setPendingAction(null);
    }
  }, [selection, sessionId]);

  const currentModelLabel = providerID && modelID ? `${providerID}/${modelID}` : null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {currentModelLabel ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Модель:</span>
          <code>{currentModelLabel}</code>
          {variant ? (
            <>
              <span>Вариант:</span>
              <code>{variant}</code>
            </>
          ) : null}
        </div>
      ) : null}

      {actualModel ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Фактическая модель:</span>
          <code>{actualModel}</code>
          {fallbackUsed ? <span>(fallback)</span> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pendingAction !== null}
          onClick={() => void handleRecover("resume")}
        >
          Возобновить
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pendingAction !== null}
          onClick={() => void handleRecover("restart")}
        >
          Перезапуск
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pendingAction !== null}
          onClick={() => setModelSwitcherOpen((value) => !value)}
        >
          {modelSwitcherOpen ? "Скрыть выбор модели" : "Выбрать другую модель"}
        </Button>
      </div>

      {modelSwitcherOpen ? (
        <div className="grid gap-2 rounded-md border border-border/60 bg-background/60 p-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span>Провайдер</span>
            <select
              name="provider"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              value={selectedProviderID}
              onChange={(event) => {
                setSelectedProviderID(event.target.value);
                setSelectedModelID("");
                setSelectedVariant("");
              }}
            >
              <option value=""></option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.id}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted-foreground">
            <span>Модель</span>
            <select
              name="model"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              value={selectedModelID}
              onChange={(event) => {
                setSelectedModelID(event.target.value);
                setSelectedVariant("");
              }}
            >
              <option value=""></option>
              {(selectedProvider?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>

          {variantOptions.length > 0 ? (
            <label className="grid gap-1 text-xs text-muted-foreground">
              <span>Вариант</span>
              <select
                name="variant"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                value={selectedVariant}
                onChange={(event) => setSelectedVariant(event.target.value)}
              >
                <option value=""></option>
                {variantOptions.map((variantOption) => (
                  <option key={variantOption} value={variantOption}>
                    {variantOption}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!selection || pendingAction !== null}
              onClick={() => void handleSwitchModel()}
            >
              Использовать для следующего запроса
            </Button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="text-xs text-[var(--status-error)]">
          {actionError}
        </div>
      ) : null}
    </div>
  );
};
