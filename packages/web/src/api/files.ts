import type {
  DirectoryListResult,
  FileReadOptions,
  FileSearchQuery,
  FileSearchResult,
  FileWorkspaceOptions,
  FilesAPI,
  ListDirectoryOptions,
} from '@openchamber/ui/lib/api/types';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';
import type { RuntimeUrlResolver } from '@openchamber/ui/lib/runtime-url';

const normalizePath = (path: string): string => path.replace(/\\/g, '/');

interface WebFilesAPIOptions {
  urls: RuntimeUrlResolver;
}

type WebDirectoryEntry = {
  name?: string;
  path?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  isSymbolicLink?: boolean;
};

type WebDirectoryListResponse = {
  directory?: string;
  path?: string;
  entries?: WebDirectoryEntry[];
};

const toDirectoryListResult = (fallbackDirectory: string, payload: WebDirectoryListResponse): DirectoryListResult => {
  const directory = normalizePath(payload?.directory || payload?.path || fallbackDirectory);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];

  return {
    directory,
    entries: entries
      .filter((entry): entry is Required<Pick<WebDirectoryEntry, 'name' | 'path'>> & { isDirectory?: boolean } =>
        Boolean(entry && typeof entry.name === 'string' && typeof entry.path === 'string')
      )
      .map((entry) => ({
        name: entry.name,
        path: normalizePath(entry.path),
        isDirectory: Boolean(entry.isDirectory),
      })),
  };
};

const directoryHeaders = (directory?: string | null): Record<string, string> | undefined => {
  const normalized = typeof directory === 'string' ? normalizePath(directory).trim() : '';
  return normalized ? { 'x-opencode-directory': normalized } : undefined;
};

const workspaceDirectory = (options?: FileWorkspaceOptions | null): string | undefined => {
  return options?.directory;
};

export const createWebFilesAPI = ({ urls }: WebFilesAPIOptions): FilesAPI => ({
  async listDirectory(path: string, options?: ListDirectoryOptions): Promise<DirectoryListResult> {
    const target = normalizePath(path);
    const params = new URLSearchParams();
    if (target) {
      params.set('path', target);
    }
    if (options?.respectGitignore) {
      params.set('respectGitignore', 'true');
    }

    const response = await runtimeFetch(urls.api('/api/fs/list', params), {
      headers: directoryHeaders(workspaceDirectory(options)),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to list directory');
    }

    const result = (await response.json()) as WebDirectoryListResponse;
    return toDirectoryListResult(target, result);
  },

  async search(payload: FileSearchQuery): Promise<FileSearchResult[]> {
    const params = new URLSearchParams();

    const directory = normalizePath(payload.directory);
    if (directory) {
      params.set('directory', directory);
    }

    params.set('query', payload.query);
    params.set('dirs', 'false');
    params.set('type', 'file');

    if (typeof payload.maxResults === 'number' && Number.isFinite(payload.maxResults)) {
      params.set('limit', String(payload.maxResults));
    }

    const response = await runtimeFetch(urls.api('/api/find/file', params), {
      headers: directoryHeaders(directory),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to search files');
    }

    const result = (await response.json()) as string[];
    const files = Array.isArray(result) ? result : [];

    return files.map((relativePath) => ({
      path: normalizePath(`${directory}/${relativePath}`),
      preview: [normalizePath(relativePath)],
    }));
  },

  async createDirectory(path: string, options?: FileWorkspaceOptions): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path);
    const response = await runtimeFetch(urls.api('/api/fs/mkdir'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(workspaceDirectory(options)) },
      body: JSON.stringify({ path: target }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to create directory');
    }

    const result = await response.json();
    return {
      success: Boolean(result?.success),
      path: typeof result?.path === 'string' ? normalizePath(result.path) : target,
    };
  },

  async statFile(path: string, options): Promise<{ path: string; isFile: boolean; size: number; mtimeMs?: number }> {
    const target = normalizePath(path);
    const params = new URLSearchParams({ path: target });
    if (options?.allowOutsideWorkspace) {
      params.set('allowOutsideWorkspace', 'true');
    }
    if (options?.outsideFileGrant) {
      params.set('outsideFileGrant', options.outsideFileGrant);
    }
    const response = await runtimeFetch(urls.api('/api/fs/stat', params), {
      headers: directoryHeaders(workspaceDirectory(options)),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to stat file');
    }

    const result = await response.json().catch(() => ({}));
    return {
      path: typeof (result as { path?: string }).path === 'string' ? normalizePath((result as { path: string }).path) : target,
      isFile: Boolean((result as { isFile?: boolean }).isFile),
      size: typeof (result as { size?: number }).size === 'number' ? (result as { size: number }).size : 0,
      mtimeMs: typeof (result as { mtimeMs?: number }).mtimeMs === 'number' ? (result as { mtimeMs: number }).mtimeMs : undefined,
    };
  },

  async readFile(path: string, options): Promise<{ content: string; path: string }> {
    const target = normalizePath(path);
    const params = new URLSearchParams({ path: target });
    if (options?.allowOutsideWorkspace) {
      params.set('allowOutsideWorkspace', 'true');
    }
    if (options?.outsideFileGrant) {
      params.set('outsideFileGrant', options.outsideFileGrant);
    }
    if (options?.optional) {
      params.set('optional', 'true');
    }
    const response = await runtimeFetch(urls.api('/api/fs/read', params), {
      cache: options?.optional ? 'no-store' : 'default',
      headers: directoryHeaders(workspaceDirectory(options)),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to read file');
    }

    const content = await response.text();
    return { content, path: target };
  },

  async writeFile(path: string, content: string, options?: FileWorkspaceOptions): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path);
    const response = await runtimeFetch(urls.api('/api/fs/write'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(workspaceDirectory(options)) },
      body: JSON.stringify({ path: target, content }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to write file');
    }

    const result = await response.json().catch(() => ({}));
    return {
      success: Boolean((result as { success?: boolean }).success),
      path: typeof (result as { path?: string }).path === 'string' ? normalizePath((result as { path: string }).path) : target,
    };
  },

  async delete(path: string, options?: FileWorkspaceOptions): Promise<{ success: boolean }> {
    const target = normalizePath(path);
    const response = await runtimeFetch(urls.api('/api/fs/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(workspaceDirectory(options)) },
      body: JSON.stringify({ path: target }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to delete file');
    }

    const result = await response.json().catch(() => ({}));
    return { success: Boolean((result as { success?: boolean }).success) };
  },

  async rename(oldPath: string, newPath: string, options?: FileWorkspaceOptions): Promise<{ success: boolean; path: string }> {
    const response = await runtimeFetch(urls.api('/api/fs/rename'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(workspaceDirectory(options)) },
      body: JSON.stringify({ oldPath, newPath }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to rename file');
    }

    const result = await response.json().catch(() => ({}));
    return {
      success: Boolean((result as { success?: boolean }).success),
      path: typeof (result as { path?: string }).path === 'string' ? normalizePath((result as { path: string }).path) : newPath,
    };
  },

  async revealPath(targetPath: string, options?: FileWorkspaceOptions): Promise<{ success: boolean }> {
    const response = await runtimeFetch(urls.api('/api/fs/reveal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(workspaceDirectory(options)) },
      body: JSON.stringify({ path: normalizePath(targetPath) }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to reveal path');
    }

    const result = await response.json().catch(() => ({}));
    return { success: Boolean((result as { success?: boolean }).success) };
  },

  async downloadFile(path: string, options?: FileReadOptions): Promise<void> {
    const target = normalizePath(path);
    const response = await runtimeFetch('/api/fs/raw', {
      query: {
        path: target,
        download: true,
        allowOutsideWorkspace: options?.allowOutsideWorkspace === true ? true : undefined,
        outsideFileGrant: options?.outsideFileGrant,
      },
      headers: directoryHeaders(workspaceDirectory(options)),
    });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = target.split('/').pop() || 'file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  },
});
