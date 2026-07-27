import fs from 'fs';
import path from 'path';
import os from 'os';

const OPENCODE_CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const OPENCODE_CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, 'opencode.json');
const OPENCODE_CONFIG_JSONC_FILE = path.join(OPENCODE_CONFIG_DIR, 'opencode.jsonc');
const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const OPENCODE_ACCOUNT_FILE = path.join(OPENCODE_DATA_DIR, 'account.json');

export const ANTIGRAVITY_ACCOUNTS_PATHS = [
  path.join(OPENCODE_CONFIG_DIR, 'antigravity-accounts.json'),
  path.join(OPENCODE_DATA_DIR, 'antigravity-accounts.json')
];

export const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch (error) {
    console.warn(`Failed to read JSON file: ${filePath}`, error);
    return null;
  }
};

const stripJsonComments = (input) => input
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const readJsoncFile = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(stripJsonComments(raw));
  } catch (error) {
    console.warn(`Failed to read JSONC file: ${filePath}`, error);
    return null;
  }
};

const readOpencodeConfigFile = () =>
  readJsonFile(OPENCODE_CONFIG_FILE) ?? readJsoncFile(OPENCODE_CONFIG_JSONC_FILE) ?? {};

const readAccountFile = () => readJsonFile(OPENCODE_ACCOUNT_FILE) ?? {};

const getConfigProviderCredential = (aliases) => {
  const config = readOpencodeConfigFile();
  const providers = config && typeof config.provider === 'object' ? config.provider : {};

  for (const alias of aliases) {
    const provider = providers?.[alias];
    const options = provider && typeof provider.options === 'object' ? provider.options : null;
    if (options?.apiKey) {
      return { key: options.apiKey };
    }
    if (options?.api_key) {
      return { key: options.api_key };
    }
    if (options?.key) {
      return { key: options.key };
    }
    if (options?.token) {
      return { token: options.token };
    }
  }

  return null;
};

const getAccountCredential = (aliases) => {
  const account = readAccountFile();
  const accounts = account && typeof account.accounts === 'object' ? account.accounts : {};
  const active = account && typeof account.active === 'object' ? account.active : {};

  for (const alias of aliases) {
    const activeAccountId = active?.[alias];
    const activeAccount = activeAccountId ? accounts?.[activeAccountId] : null;
    if (activeAccount?.credential) {
      return activeAccount.credential;
    }
  }

  for (const accountEntry of Object.values(accounts)) {
    if (accountEntry?.serviceID && aliases.includes(accountEntry.serviceID) && accountEntry?.credential) {
      return accountEntry.credential;
    }
  }

  return null;
};

export const getAuthEntry = (auth, aliases) => {
  for (const alias of aliases) {
    if (auth[alias]) {
      return auth[alias];
    }
  }
  return getAccountCredential(aliases) ?? getConfigProviderCredential(aliases);
};

export const normalizeAuthEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { token: entry };
  }
  if (typeof entry === 'object') {
    return entry;
  }
  return null;
};
