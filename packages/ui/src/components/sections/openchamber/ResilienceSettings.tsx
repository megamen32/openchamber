import * as React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import {
  SettingsCheckboxRow,
  SettingsFieldRow,
  SettingsInset,
  SettingsSection,
  SETTINGS_NUMBER_STEPPER_ROW_CLASS,
  SETTINGS_NUMBER_UNIT_CLASS,
  SETTINGS_OPTION_STACK_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { opencodeClient } from '@/lib/opencode/client';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useResilienceSettingsStore } from '@/stores/useResilienceSettingsStore';

const fallbackModelIdsToText = (value: string[]): string => value.join('\n');

const parseFallbackModelIds = (value: string): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const modelId = line.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    next.push(modelId);
    if (next.length >= 16) {
      break;
    }
  }
  return next;
};

export const ResilienceSettings: React.FC = () => {
  const { t } = useI18n();
  const settings = useResilienceSettingsStore((state) => state.settings);
  const availableFallbackModelIds = useResilienceSettingsStore((state) => state.availableFallbackModelIds);
  const isLoading = useResilienceSettingsStore((state) => state.isLoading);
  const save = useResilienceSettingsStore((state) => state.save);
  const load = useResilienceSettingsStore((state) => state.load);
  const activeProjectPath = useProjectsStore((state) => state.getActiveProject()?.path ?? null);
  const runtimeKey = getRuntimeKey();
  const currentDirectory = activeProjectPath ?? opencodeClient.getDirectory() ?? null;

  const [fallbackDraft, setFallbackDraft] = React.useState(() => fallbackModelIdsToText(settings.fallbackModelIds));

  React.useEffect(() => {
    setFallbackDraft(fallbackModelIdsToText(settings.fallbackModelIds));
  }, [settings.fallbackModelIds]);

  React.useEffect(() => {
    void load(currentDirectory);
  }, [currentDirectory, load, runtimeKey]);

  const handleFallbackBlur = React.useCallback(() => {
    const next = parseFallbackModelIds(fallbackDraft);
    if (fallbackModelIdsToText(next) === fallbackModelIdsToText(settings.fallbackModelIds)) {
      return;
    }
    void save({ fallbackModelIds: next });
  }, [fallbackDraft, save, settings.fallbackModelIds]);

  return (
    <SettingsSection
      title={t('settings.openchamber.resilience.title')}
      description={t('settings.openchamber.resilience.description')}
      info={t('settings.openchamber.resilience.note.nextRequestOnly')}
    >
      <SettingsInset className={SETTINGS_OPTION_STACK_CLASS}>
        <SettingsCheckboxRow
          settingsItem="sessions.resilience.auto-resume"
          checked={settings.autoResume}
          onChange={(checked) => void save({ autoResume: checked })}
          label={t('settings.openchamber.resilience.field.autoResume')}
          ariaLabel={t('settings.openchamber.resilience.field.autoResumeAria')}
          info={t('settings.openchamber.resilience.field.autoResumeHint')}
          disabled={isLoading}
        />

        <SettingsCheckboxRow
          settingsItem="sessions.resilience.fallback-enabled"
          checked={settings.fallbackEnabled}
          onChange={(checked) => void save({ fallbackEnabled: checked })}
          label={t('settings.openchamber.resilience.field.fallbackEnabled')}
          ariaLabel={t('settings.openchamber.resilience.field.fallbackEnabledAria')}
          info={t('settings.openchamber.resilience.field.fallbackEnabledHint')}
          disabled={isLoading}
        />

        <SettingsFieldRow
          settingsItem="sessions.resilience.response-timeout"
          label={t('settings.openchamber.resilience.field.responseTimeoutMs')}
          info={t('settings.openchamber.resilience.field.responseTimeoutMsHint')}
        >
          <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
            <NumberInput
              value={settings.responseTimeoutMs}
              onValueChange={(value) => void save({ responseTimeoutMs: value })}
              min={0}
              step={1000}
              className="w-24 tabular-nums"
              disabled={isLoading}
            />
            <span className={SETTINGS_NUMBER_UNIT_CLASS}>ms</span>
          </div>
        </SettingsFieldRow>

        <SettingsFieldRow
          settingsItem="sessions.resilience.tool-timeout"
          label={t('settings.openchamber.resilience.field.toolTimeoutMs')}
          info={t('settings.openchamber.resilience.field.toolTimeoutMsHint')}
        >
          <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
            <NumberInput
              value={settings.toolTimeoutMs}
              onValueChange={(value) => void save({ toolTimeoutMs: value })}
              min={0}
              step={1000}
              className="w-24 tabular-nums"
              disabled={isLoading}
            />
            <span className={SETTINGS_NUMBER_UNIT_CLASS}>ms</span>
          </div>
        </SettingsFieldRow>

        <SettingsFieldRow
          settingsItem="sessions.resilience.retries"
          label={t('settings.openchamber.resilience.field.retries')}
          info={t('settings.openchamber.resilience.field.retriesHint')}
        >
          <NumberInput
            value={settings.retries}
            onValueChange={(value) => void save({ retries: value })}
            min={0}
            step={1}
            className="w-20 tabular-nums"
            disabled={isLoading}
          />
        </SettingsFieldRow>

        <SettingsFieldRow
          settingsItem="sessions.resilience.retry-delay"
          label={t('settings.openchamber.resilience.field.retryDelayMs')}
          info={t('settings.openchamber.resilience.field.retryDelayMsHint')}
        >
          <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
            <NumberInput
              value={settings.retryDelayMs}
              onValueChange={(value) => void save({ retryDelayMs: value })}
              min={0}
              step={250}
              className="w-24 tabular-nums"
              disabled={isLoading}
            />
            <span className={SETTINGS_NUMBER_UNIT_CLASS}>ms</span>
          </div>
        </SettingsFieldRow>

        <SettingsFieldRow
          settingsItem="sessions.resilience.fallback-model-ids"
          label={t('settings.openchamber.resilience.field.fallbackModelIds')}
          info={t('settings.openchamber.resilience.field.fallbackModelIdsHint')}
          alignEnd={false}
          controlClassName="w-full max-w-[28rem]"
        >
          <div className="w-full space-y-2">
            <Textarea
              simple
              rows={4}
              value={fallbackDraft}
              onChange={(event) => setFallbackDraft(event.target.value)}
              onBlur={handleFallbackBlur}
              placeholder={t('settings.openchamber.resilience.field.fallbackModelIdsPlaceholder')}
              disabled={isLoading || !settings.fallbackEnabled}
              className="min-h-[7rem] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            />
            {availableFallbackModelIds.length > 0 ? (
              <p className="typography-meta text-muted-foreground">
                {t('settings.openchamber.resilience.field.availableModelIds')}
                {' '}
                {availableFallbackModelIds.join(', ')}
              </p>
            ) : null}
          </div>
        </SettingsFieldRow>
      </SettingsInset>
    </SettingsSection>
  );
};
