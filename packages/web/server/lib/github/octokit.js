import { Octokit } from '@octokit/rest';
import { getGitHubAuth, isGhCliDisabled } from './auth.js';
import { getGhCliToken } from './gh-cli-credential.js';

export function getOctokitOrNull(cachedGhToken) {
  const auth = getGitHubAuth();
  const ghToken = cachedGhToken !== undefined
    ? cachedGhToken
    : (!isGhCliDisabled() ? getGhCliToken() : null);
  const token = auth?.accessToken || ghToken;
  if (!token) {
    return null;
  }
  return new Octokit({ auth: token });
}
