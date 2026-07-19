import { spawn as defaultSpawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const normalizeTarget = (target) => {
  if (typeof target !== 'string') return undefined;
  const normalized = target.trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Validate that an OpenCode server is local before running a local CLI updater.
 *
 * @param {string} baseUrl External OpenCode server URL.
 * @returns {URL} Parsed local URL.
 * @throws {Error} If the URL is invalid or points at a remote host.
 */
export const assertLocalExternalHost = (baseUrl) => {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const error = new Error('External OpenCode update requires a valid server URL');
    error.code = 'EXTERNAL_OPENCODE_INVALID_URL';
    throw error;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    const error = new Error('External OpenCode server is remote; update it on the machine that owns the server');
    error.code = 'EXTERNAL_OPENCODE_REMOTE';
    throw error;
  }

  return parsed;
};

const captureStream = (stream, chunks) => {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('data', (chunk) => {
    chunks.push(String(chunk));
  });
};

const runUpgradeCommand = ({ binary, args, spawn, env, cwd, timeoutMs }) => new Promise((resolve, reject) => {
  let child;
  try {
    child = spawn(binary, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    reject(error);
    return;
  }

  const stdout = [];
  const stderr = [];
  captureStream(child.stdout, stdout);
  captureStream(child.stderr, stderr);

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // The process may already have exited between the timeout and kill.
    }
    reject(new Error(`OpenCode upgrade timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const finish = (error, code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);

    if (error) {
      reject(error);
      return;
    }

    const output = [...stdout, ...stderr].join('').trim();
    if (code !== 0) {
      const detail = output ? `: ${output}` : '';
      reject(new Error(`OpenCode upgrade failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}${detail}`));
      return;
    }

    resolve(output);
  };

  child.once('error', (error) => finish(error, null, null));
  child.once('close', (code, signal) => finish(null, code, signal));
});

/**
 * Upgrade a locally installed external OpenCode CLI without owning its server process.
 *
 * @param {object} options Upgrade options.
 * @param {string} options.baseUrl Connected OpenCode server URL.
 * @param {string} options.binary Resolved executable path.
 * @param {string|undefined} options.target Optional version target.
 * @param {Function} [options.spawn] Child-process spawn implementation.
 * @param {NodeJS.ProcessEnv} [options.env] Child environment.
 * @param {string} [options.cwd] Child working directory.
 * @param {number} [options.timeoutMs] Command timeout.
 * @returns {Promise<{success: true, method: 'cli', restartRequired: true, target?: string}>} Upgrade result.
 */
export const upgradeExternalOpenCode = async ({
  baseUrl,
  binary,
  target,
  spawn = defaultSpawn,
  env = process.env,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  assertLocalExternalHost(baseUrl);

  if (typeof binary !== 'string' || binary.trim().length === 0) {
    throw new Error('OpenCode CLI binary could not be resolved for external update');
  }

  const normalizedTarget = normalizeTarget(target);
  const args = ['upgrade'];
  if (normalizedTarget) args.push(normalizedTarget);

  await runUpgradeCommand({
    binary: binary.trim(),
    args,
    spawn,
    env,
    cwd,
    timeoutMs,
  });

  return {
    success: true,
    method: 'cli',
    restartRequired: true,
    ...(normalizedTarget ? { target: normalizedTarget } : {}),
  };
};
