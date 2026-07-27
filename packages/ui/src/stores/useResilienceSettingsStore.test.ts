import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { SettingsPayload } from '@/lib/api/types';
import { getRuntimeKey, switchRuntimeEndpoint } from '@/lib/runtime-switch';

type ResilienceSettingsPayload = {
  autoResume?: unknown;
  retries?: unknown;
  retryDelayMs?: unknown;
  responseTimeoutMs?: unknown;
  toolTimeoutMs?: unknown;
  fallbackEnabled?: unknown;
  fallbackModelIds?: unknown;
};

type TestWindow = {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  dispatchEvent: (event: Event) => boolean;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

const DIRECTORY_A = '/workspace/project-a';
const DIRECTORY_B = '/workspace/project-b';

let createdWindow = false;
let createdLocalStorage = false;

const settingsByRuntime = new Map<string, ResilienceSettingsPayload>();
const providerModelIdsByDirectory = new Map<string, string[]>();

let runtimeFetchImpl: (input: string, init?: RequestInit) => Promise<Response> = async () =>
  new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
let updateDesktopSettingsImpl: (changes: Partial<SettingsPayload>) => Promise<void> = async () => undefined;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const responseWithJson = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });

const ensureLocalStorage = (): void => {
  if (typeof localStorage !== 'undefined') {
    return;
  }

  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    },
  });
  createdLocalStorage = true;
};

const ensureWindow = (): TestWindow => {
  if (typeof window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {},
    });
    createdWindow = true;
  }

  const scopedWindow = window as unknown as Partial<TestWindow>;
  if (!scopedWindow.addEventListener || !scopedWindow.removeEventListener) {
    const eventTarget = new EventTarget();
    scopedWindow.addEventListener = eventTarget.addEventListener.bind(eventTarget);
    scopedWindow.removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
    scopedWindow.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);
  }
  scopedWindow.dispatchEvent ??= () => true;
  scopedWindow.setTimeout ??= setTimeout;
  scopedWindow.clearTimeout ??= clearTimeout;
  ensureLocalStorage();
  return scopedWindow as TestWindow;
};

mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: mock(() => null),
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return runtimeFetchImpl(url, init);
  }),
}));

mock.module('@/lib/persistence', () => ({
  updateDesktopSettings: mock(async (changes: Partial<SettingsPayload>) => updateDesktopSettingsImpl(changes)),
}));

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getProvidersForConfig: mock(async (directory?: string | null) => {
      const ids = providerModelIdsByDirectory.get(directory ?? '') ?? [];
      return {
        providers: ids.map((id) => {
          const [providerId, modelId] = id.split('/', 2);
          return {
            id: providerId,
            name: providerId,
            source: 'config',
            env: [],
            options: {},
            models: [
              {
                id: modelId,
                name: modelId,
                providerID: providerId,
                api: { id: 'chat', url: '', npm: '' },
                capabilities: {
                  temperature: true,
                  reasoning: false,
                  attachment: false,
                  toolcall: true,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: false,
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 0, output: 0 },
                options: {},
                release_date: '',
                status: 'active',
                headers: {},
                attachment: false,
                reasoning: false,
                temperature: true,
                tool_call: true,
              },
            ],
          };
        }),
        default: {},
      };
    }),
  },
}));

const { useResilienceSettingsStore, DEFAULT_RESILIENCE_SETTINGS } = await import('./useResilienceSettingsStore');

describe('useResilienceSettingsStore', () => {
  beforeEach(() => {
    ensureWindow();
    settingsByRuntime.clear();
    providerModelIdsByDirectory.clear();
    runtimeFetchImpl = async (input: string, init?: RequestInit) => {
      if (input !== '/api/config/settings' || init?.method !== 'GET') {
        return responseWithJson({});
      }
      return responseWithJson(settingsByRuntime.get(getRuntimeKey()) ?? {});
    };
    updateDesktopSettingsImpl = async () => undefined;

    switchRuntimeEndpoint({ apiBaseUrl: 'https://runtime-a.example', runtimeKey: 'runtime-a' });

    useResilienceSettingsStore.setState({
      settings: DEFAULT_RESILIENCE_SETTINGS,
      availableFallbackModelIds: [],
      isLoading: false,
      isSaving: false,
      runtimeKey: null,
      directory: null,
    });
  });

  test('loads persisted settings and directory-scoped fallback model choices', async () => {
    settingsByRuntime.set('runtime-a', {
      autoResume: true,
      retries: 2,
      retryDelayMs: 1500,
      responseTimeoutMs: 30000,
      toolTimeoutMs: 45000,
      fallbackEnabled: true,
      fallbackModelIds: ['openai/gpt-4.1', 'anthropic/claude-4-sonnet'],
    });
    providerModelIdsByDirectory.set(DIRECTORY_A, [
      'openai/gpt-4.1',
      'anthropic/claude-4-sonnet',
    ]);
    providerModelIdsByDirectory.set(DIRECTORY_B, ['google/gemini-2.5-pro']);

    await useResilienceSettingsStore.getState().load(DIRECTORY_A);

    expect(useResilienceSettingsStore.getState().settings).toEqual({
      autoResume: true,
      retries: 2,
      retryDelayMs: 1500,
      responseTimeoutMs: 30000,
      toolTimeoutMs: 45000,
      fallbackEnabled: true,
      fallbackModelIds: ['openai/gpt-4.1', 'anthropic/claude-4-sonnet'],
    });
    expect(useResilienceSettingsStore.getState().availableFallbackModelIds).toEqual([
      'openai/gpt-4.1',
      'anthropic/claude-4-sonnet',
    ]);

    await useResilienceSettingsStore.getState().load(DIRECTORY_B);

    expect(useResilienceSettingsStore.getState().availableFallbackModelIds).toEqual([
      'google/gemini-2.5-pro',
    ]);
    expect(useResilienceSettingsStore.getState().directory).toBe(DIRECTORY_B);
  });

  test('ignores stale load results after a runtime switch', async () => {
    const runtimeALoad = deferred<Response>();
    settingsByRuntime.set('runtime-b', {
      autoResume: false,
      retries: 1,
      retryDelayMs: 500,
      responseTimeoutMs: 12000,
      toolTimeoutMs: 18000,
      fallbackEnabled: false,
      fallbackModelIds: ['google/gemini-2.5-pro'],
    });
    providerModelIdsByDirectory.set(DIRECTORY_A, ['openai/gpt-4.1']);
    providerModelIdsByDirectory.set(DIRECTORY_B, ['google/gemini-2.5-pro']);

    runtimeFetchImpl = async (input: string, init?: RequestInit) => {
      if (input !== '/api/config/settings' || init?.method !== 'GET') {
        return responseWithJson({});
      }
      if (getRuntimeKey() === 'runtime-a') {
        return runtimeALoad.promise;
      }
      return responseWithJson(settingsByRuntime.get('runtime-b') ?? {});
    };

    const loadA = useResilienceSettingsStore.getState().load(DIRECTORY_A);

    switchRuntimeEndpoint({ apiBaseUrl: 'https://runtime-b.example', runtimeKey: 'runtime-b' });
    const loadB = useResilienceSettingsStore.getState().load(DIRECTORY_B);

    runtimeALoad.resolve(responseWithJson({
      autoResume: true,
      retries: 9,
      retryDelayMs: 9000,
      responseTimeoutMs: 90000,
      toolTimeoutMs: 91000,
      fallbackEnabled: true,
      fallbackModelIds: ['openai/gpt-4.1'],
    }));

    await Promise.all([loadA, loadB]);

    expect(useResilienceSettingsStore.getState().runtimeKey).toBe('runtime-b');
    expect(useResilienceSettingsStore.getState().directory).toBe(DIRECTORY_B);
    expect(useResilienceSettingsStore.getState().settings.retries).toBe(1);
    expect(useResilienceSettingsStore.getState().availableFallbackModelIds).toEqual([
      'google/gemini-2.5-pro',
    ]);
  });

  test('pending save from a previous runtime does not overwrite next-runtime state', async () => {
    const runtimeASave = deferred<void>();

    settingsByRuntime.set('runtime-a', {
      autoResume: false,
      retries: 0,
      retryDelayMs: 0,
      responseTimeoutMs: 0,
      toolTimeoutMs: 0,
      fallbackEnabled: false,
      fallbackModelIds: [],
    });
    settingsByRuntime.set('runtime-b', {
      autoResume: true,
      retries: 1,
      retryDelayMs: 250,
      responseTimeoutMs: 10000,
      toolTimeoutMs: 20000,
      fallbackEnabled: true,
      fallbackModelIds: ['google/gemini-2.5-pro'],
    });
    providerModelIdsByDirectory.set(DIRECTORY_A, ['openai/gpt-4.1']);
    providerModelIdsByDirectory.set(DIRECTORY_B, ['google/gemini-2.5-pro']);

    updateDesktopSettingsImpl = async (changes: Partial<SettingsPayload>) => {
      expect(changes).toEqual({
        retries: 5,
        fallbackEnabled: true,
        fallbackModelIds: ['openai/gpt-4.1'],
      });
      if (getRuntimeKey() === 'runtime-a') {
        await runtimeASave.promise;
      }
    };

    await useResilienceSettingsStore.getState().load(DIRECTORY_A);
    const savePromise = useResilienceSettingsStore.getState().save({
      retries: 5,
      fallbackEnabled: true,
      fallbackModelIds: ['openai/gpt-4.1'],
    });

    switchRuntimeEndpoint({ apiBaseUrl: 'https://runtime-b.example', runtimeKey: 'runtime-b' });
    await useResilienceSettingsStore.getState().load(DIRECTORY_B);

    runtimeASave.resolve();
    await savePromise;

    expect(useResilienceSettingsStore.getState().runtimeKey).toBe('runtime-b');
    expect(useResilienceSettingsStore.getState().directory).toBe(DIRECTORY_B);
    expect(useResilienceSettingsStore.getState().settings).toEqual({
      autoResume: true,
      retries: 1,
      retryDelayMs: 250,
      responseTimeoutMs: 10000,
      toolTimeoutMs: 20000,
      fallbackEnabled: true,
      fallbackModelIds: ['google/gemini-2.5-pro'],
    });
  });
});

