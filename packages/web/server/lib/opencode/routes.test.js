import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerOpenCodeRoutes } from './routes.js';

const originalFetch = globalThis.fetch;

const createSuccessfulChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit('close', 0, null));
  return child;
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const createRoute = ({ baseUrl, external = true, spawn = vi.fn(() => createSuccessfulChild()) } = {}) => {
  const routes = new Map();
  const app = {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    put(path, handler) {
      routes.set(`PUT ${path}`, handler);
    },
    delete(path, handler) {
      routes.set(`DELETE ${path}`, handler);
    },
  };

  registerOpenCodeRoutes(app, {
    crypto: {},
    clientReloadDelayMs: 0,
    getOpenCodeResolutionSnapshot: vi.fn(async () => ({ resolved: '/tmp/opencode', source: 'path' })),
    isExternalOpenCode: () => external,
    formatSettingsResponse: (value) => value,
    readSettingsFromDisk: vi.fn(async () => ({})),
    readSettingsFromDiskMigrated: vi.fn(async () => ({})),
    persistSettings: vi.fn(async (value) => value),
    sanitizeProjects: (value) => value,
    validateDirectoryPath: vi.fn(async () => true),
    resolveProjectDirectory: vi.fn(async (value) => value),
    getProviderSources: vi.fn(async () => []),
    removeProviderConfig: vi.fn(async () => ({ success: true })),
    refreshOpenCodeAfterConfigChange: vi.fn(async () => undefined),
    buildOpenCodeUrl: (path) => `${baseUrl}${path}`,
    getOpenCodeAuthHeaders: () => ({}),
    spawn,
  });

  return routes.get('POST /api/opencode/upgrade');
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenCode upgrade route', () => {
  it('falls back to the local CLI when an external server lacks /global/upgrade', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' }));
    const spawn = vi.fn(() => createSuccessfulChild());
    const handler = createRoute({ baseUrl: 'http://127.0.0.1:4096', spawn });
    const response = createResponse();

    await handler({ body: { target: '1.17.18' } }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ success: true, method: 'cli', restartRequired: true, restarted: false });
    expect(spawn).toHaveBeenCalledWith(
      '/tmp/opencode',
      ['upgrade', '1.17.18'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('refuses a CLI fallback for a remote external server', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' }));
    const spawn = vi.fn(() => createSuccessfulChild());
    const handler = createRoute({ baseUrl: 'https://remote.example:4096', spawn });
    const response = createResponse();

    await handler({ body: {} }, response);

    expect(response.statusCode).toBe(422);
    expect(response.body.error).toMatch(/remote/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});
