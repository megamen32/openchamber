import { create } from 'zustand';

import type { DesktopSettings } from '@/lib/desktop';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { opencodeClient } from '@/lib/opencode/client';
import { updateDesktopSettings } from '@/lib/persistence';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

export type ResilienceSettings = {
  autoResume: boolean;
  retries: number;
  retryDelayMs: number;
  responseTimeoutMs: number;
  toolTimeoutMs: number;
  fallbackEnabled: boolean;
  fallbackModelIds: string[];
};

export type ResilienceSettingsStore = {
  settings: ResilienceSettings;
  availableFallbackModelIds: string[];
  isLoading: boolean;
  isSaving: boolean;
  runtimeKey: string | null;
  directory: string | null;
  load: (directory?: string | null) => Promise<void>;
  save: (changes: Partial<ResilienceSettings>) => Promise<void>;
};

const FALLBACK_MODEL_IDS_LIMIT = 16;

export const DEFAULT_RESILIENCE_SETTINGS: ResilienceSettings = {
  autoResume: false,
  retries: 0,
  retryDelayMs: 0,
  responseTimeoutMs: 0,
  toolTimeoutMs: 0,
  fallbackEnabled: false,
  fallbackModelIds: [],
};

const normalizeNonNegativeInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
};

const normalizeFallbackModelIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of value) {
    const modelId = typeof entry === 'string' ? entry.trim() : '';
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    next.push(modelId);
    if (next.length >= FALLBACK_MODEL_IDS_LIMIT) {
      break;
    }
  }
  return next;
};

export const normalizeResilienceSettings = (payload: unknown): ResilienceSettings => {
  const candidate = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};

  return {
    autoResume: candidate.autoResume === true,
    retries: normalizeNonNegativeInteger(candidate.retries, DEFAULT_RESILIENCE_SETTINGS.retries),
    retryDelayMs: normalizeNonNegativeInteger(candidate.retryDelayMs, DEFAULT_RESILIENCE_SETTINGS.retryDelayMs),
    responseTimeoutMs: normalizeNonNegativeInteger(candidate.responseTimeoutMs, DEFAULT_RESILIENCE_SETTINGS.responseTimeoutMs),
    toolTimeoutMs: normalizeNonNegativeInteger(candidate.toolTimeoutMs, DEFAULT_RESILIENCE_SETTINGS.toolTimeoutMs),
    fallbackEnabled: candidate.fallbackEnabled === true,
    fallbackModelIds: normalizeFallbackModelIds(candidate.fallbackModelIds),
  };
};

const RESILIENCE_SETTING_KEYS = [
  'autoResume',
  'retries',
  'retryDelayMs',
  'responseTimeoutMs',
  'toolTimeoutMs',
  'fallbackEnabled',
  'fallbackModelIds',
] as const satisfies readonly (keyof ResilienceSettings)[];

const pickChangedResilienceSettings = (
  baseline: ResilienceSettings,
  changes: Partial<ResilienceSettings>,
): Partial<ResilienceSettings> => {
  const merged = normalizeResilienceSettings({ ...baseline, ...changes });
  const next: Partial<ResilienceSettings> = {};

  for (const key of RESILIENCE_SETTING_KEYS) {
    if (!(key in changes)) {
      continue;
    }

    switch (key) {
      case 'autoResume':
        next.autoResume = merged.autoResume;
        break;
      case 'retries':
        next.retries = merged.retries;
        break;
      case 'retryDelayMs':
        next.retryDelayMs = merged.retryDelayMs;
        break;
      case 'responseTimeoutMs':
        next.responseTimeoutMs = merged.responseTimeoutMs;
        break;
      case 'toolTimeoutMs':
        next.toolTimeoutMs = merged.toolTimeoutMs;
        break;
      case 'fallbackEnabled':
        next.fallbackEnabled = merged.fallbackEnabled;
        break;
      case 'fallbackModelIds':
        next.fallbackModelIds = merged.fallbackModelIds;
        break;
    }
  }

  return next;
};

const toDesktopSettingsPatch = (settings: Partial<ResilienceSettings>): Partial<DesktopSettings> => {
  const patch: Partial<DesktopSettings> = {};

  for (const key of RESILIENCE_SETTING_KEYS) {
    if (!(key in settings)) {
      continue;
    }

    switch (key) {
      case 'autoResume':
        patch.autoResume = settings.autoResume;
        break;
      case 'retries':
        patch.retries = settings.retries;
        break;
      case 'retryDelayMs':
        patch.retryDelayMs = settings.retryDelayMs;
        break;
      case 'responseTimeoutMs':
        patch.responseTimeoutMs = settings.responseTimeoutMs;
        break;
      case 'toolTimeoutMs':
        patch.toolTimeoutMs = settings.toolTimeoutMs;
        break;
      case 'fallbackEnabled':
        patch.fallbackEnabled = settings.fallbackEnabled;
        break;
      case 'fallbackModelIds':
        patch.fallbackModelIds = settings.fallbackModelIds;
        break;
    }
  }

  return patch;
};

const readResilienceSettings = async (): Promise<ResilienceSettings> => {
  const runtimeSettings = getRegisteredRuntimeAPIs()?.settings;
  if (runtimeSettings) {
    try {
      const result = await runtimeSettings.load();
      return normalizeResilienceSettings(result?.settings);
    } catch (error) {
      console.warn('Failed to load resilience settings from runtime settings API:', error);
    }
  }

  try {
    const response = await runtimeFetch('/api/config/settings', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return DEFAULT_RESILIENCE_SETTINGS;
    }
    const payload = await response.json().catch(() => null);
    return normalizeResilienceSettings(payload);
  } catch (error) {
    console.warn('Failed to load resilience settings from runtime settings route:', error);
    return DEFAULT_RESILIENCE_SETTINGS;
  }
};

const listAvailableFallbackModelIds = async (directory?: string | null): Promise<string[]> => {
  try {
    const response = await opencodeClient.getProvidersForConfig(directory);
    const providers = Array.isArray(response?.providers) ? response.providers : [];
    const seen = new Set<string>();
    const ids: string[] = [];

    for (const provider of providers) {
      if (!provider || typeof provider !== 'object') {
        continue;
      }
      const providerId = typeof provider.id === 'string' ? provider.id.trim() : '';
      if (!providerId) {
        continue;
      }
      const models = Array.isArray(provider.models)
        ? provider.models
        : provider.models && typeof provider.models === 'object'
          ? Object.values(provider.models)
          : [];

      for (const model of models) {
        if (!model || typeof model !== 'object') {
          continue;
        }
        const modelId = typeof (model as { id?: unknown }).id === 'string'
          ? (model as { id: string }).id.trim()
          : '';
        if (!modelId) {
          continue;
        }
        const compositeId = `${providerId}/${modelId}`;
        if (seen.has(compositeId)) {
          continue;
        }
        seen.add(compositeId);
        ids.push(compositeId);
      }
    }

    return ids;
  } catch (error) {
    console.warn('Failed to load fallback model catalog for resilience settings:', error);
    return [];
  }
};

let lifecycleInitialized = false;
let loadGeneration = 0;
let saveGeneration = 0;

const invalidatePendingOperations = (): void => {
  loadGeneration += 1;
  saveGeneration += 1;
};

const ensureLifecycle = (): void => {
  if (lifecycleInitialized) {
    return;
  }
  lifecycleInitialized = true;

  subscribeRuntimeEndpointChanged(() => {
    invalidatePendingOperations();
    useResilienceSettingsStore.setState({
      isLoading: false,
      isSaving: false,
      runtimeKey: getRuntimeKey(),
    });
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('openchamber:settings-synced', (event: Event) => {
      const detail = (event as CustomEvent<DesktopSettings>).detail;
      if (!detail || typeof detail !== 'object') {
        return;
      }
      useResilienceSettingsStore.setState((state) => ({
        settings: normalizeResilienceSettings({ ...state.settings, ...detail }),
        isSaving: false,
      }));
    });
  }
};

export const useResilienceSettingsStore = create<ResilienceSettingsStore>((set, get) => ({
  settings: DEFAULT_RESILIENCE_SETTINGS,
  availableFallbackModelIds: [],
  isLoading: false,
  isSaving: false,
  runtimeKey: null,
  directory: null,

  load: async (directory) => {
    ensureLifecycle();
    const normalizedDirectory = typeof directory === 'string' && directory.trim().length > 0
      ? directory.trim()
      : null;
    const runtimeKey = getRuntimeKey();
    const generation = ++loadGeneration;

    set({
      isLoading: true,
      runtimeKey,
      directory: normalizedDirectory,
    });

    const [settings, availableFallbackModelIds] = await Promise.all([
      readResilienceSettings(),
      listAvailableFallbackModelIds(normalizedDirectory),
    ]);

    if (generation !== loadGeneration || runtimeKey !== getRuntimeKey()) {
      return;
    }

    set({
      settings,
      availableFallbackModelIds,
      isLoading: false,
      runtimeKey,
      directory: normalizedDirectory,
    });
  },

  save: async (changes) => {
    ensureLifecycle();
    const baseline = get().settings;
    const nextSettings = normalizeResilienceSettings({ ...baseline, ...changes });
    const changedSettings = pickChangedResilienceSettings(baseline, changes);
    const runtimeKey = getRuntimeKey();
    const generation = ++saveGeneration;

    set({
      settings: nextSettings,
      isSaving: true,
      runtimeKey,
    });

    if (Object.keys(changedSettings).length === 0) {
      if (generation === saveGeneration && runtimeKey === getRuntimeKey()) {
        set({ isSaving: false });
      }
      return;
    }

    try {
      await updateDesktopSettings(toDesktopSettingsPatch(changedSettings));
    } finally {
      if (generation === saveGeneration && runtimeKey === getRuntimeKey()) {
        set({ isSaving: false });
      }
    }
  },
}));
