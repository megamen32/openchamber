# External OpenCode Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or execute the tasks inline with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenChamber able to update a locally running external OpenCode installation when an older server does not expose `/global/upgrade`, while refusing unsafe updates for remote servers.

**Architecture:** Keep the existing server-side OpenCode upgrade route as the first path. When the connected server reports that the endpoint is unsupported, resolve the configured local CLI binary and run its argument-array upgrade command without a shell. Return whether the binary was updated and whether the external server must be restarted; preserve the existing external-server re-probe and notification flow.

**Tech Stack:** Node.js web server, Express route modules, React/TypeScript settings and toast UI, Vitest, Bun, Playwright CLI.

## Global Constraints

- Official OpenCode HTTP calls remain server-side and authenticated through the existing OpenChamber route/runtime boundary.
- External updates are local-only; a remote `OPENCODE_HOST` must return an explicit unsupported error.
- Never terminate or signal an external OpenCode process owned by another supervisor.
- User-facing strings must be added to every locale dictionary.
- The existing managed/bundled update behavior must remain unchanged.

---

### Task 1: Add regression coverage for external CLI fallback

**Files:**
- Create: `packages/web/server/lib/opencode/external-upgrade.test.js`
- Modify: `packages/web/server/lib/opencode/routes.test.js` if route coverage is added there

**Interfaces:**
- Tests consume the new `upgradeExternalOpenCode` helper and the `/api/opencode/upgrade` route.
- Tests produce proof that an unsupported server endpoint falls back to the resolved binary, forwards a target as an argv item, rejects remote hosts, and reports restart-required semantics.

- [ ] **Step 1: Write the failing helper tests**

  Cover these exact cases:

  ```js
  it('runs the resolved OpenCode CLI upgrade without a shell', async () => {
    const spawn = vi.fn(() => fakeSuccessfulChild({ stdout: 'updated 1.17.18\\n' }));
    const result = await upgradeExternalOpenCode({ binary: '/tmp/opencode', target: '1.17.18', spawn });
    expect(spawn).toHaveBeenCalledWith('/tmp/opencode', ['upgrade', '1.17.18'], expect.objectContaining({ shell: false }));
    expect(result).toMatchObject({ success: true, method: 'cli', restartRequired: true });
  });

  it('rejects a non-local external host', () => {
    expect(() => assertLocalExternalHost('https://remote.example:4096')).toThrow(/remote/i);
  });
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```bash
  bun test packages/web/server/lib/opencode/external-upgrade.test.js
  ```

  Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Add route regression tests**

  Capture the registered `POST /api/opencode/upgrade` handler with a minimal fake app. Stub the upstream request as `404`, inject a successful CLI updater, and assert HTTP 200 with `method: "cli"`, `restartRequired: true`. Add a second test asserting that a non-local external URL returns HTTP 422 without invoking the updater.

- [ ] **Step 4: Run the focused tests and verify they fail for the missing implementation**

  Run:

  ```bash
  bun test packages/web/server/lib/opencode/external-upgrade.test.js packages/web/server/lib/opencode/routes.test.js
  ```

  Expected: FAIL only in the new cases.

---

### Task 2: Implement safe external OpenCode upgrade fallback

**Files:**
- Create: `packages/web/server/lib/opencode/external-upgrade.js`
- Modify: `packages/web/server/lib/opencode/routes.js`
- Modify: `packages/web/server/lib/opencode/feature-routes-runtime.js`
- Modify: `packages/web/server/index.js`

**Interfaces:**
- `assertLocalExternalHost(baseUrl): URL` validates loopback/private local host policy for local external servers.
- `upgradeExternalOpenCode({ binary, target, spawn, env, cwd }): Promise<{ success: true, method: 'cli', restartRequired: true, version?: string }>` runs the binary with argv only and rejects non-zero exits.
- Route dependency `isExternalOpenCode` identifies the active external lifecycle mode without allowing the route to kill its process.

- [ ] **Step 1: Implement the minimal helper**

  Add a promise wrapper around injected `spawn`, with `shell: false`, bounded stdout/stderr capture, and a clear non-zero exit error. Normalize a target only as a single non-empty version argument. Reject non-local URL hosts before the command runs.

- [ ] **Step 2: Wire the route fallback**

  In `POST /api/opencode/upgrade`:

  1. Preserve the bundled binary conflict response.
  2. Call the existing `/global/upgrade` first.
  3. On `404`, `405`, or `501`, resolve the configured binary through `getOpenCodeResolutionSnapshot` and run the CLI helper only for a local external server.
  4. Call `refreshOpenCodeAfterConfigChange` for the existing re-probe behavior.
  5. Return `method: 'cli'` and `restartRequired: true` for the fallback; do not claim that an external process was restarted.
  6. Preserve upstream errors for authentication and server failures instead of silently replacing them with a local command.

- [ ] **Step 3: Pass lifecycle and process dependencies through the route registration**

  Thread `spawn` and `isExternalOpenCode` from `index.js` through `feature-routes-runtime.js` to `registerOpenCodeRoutes`. Keep the existing `spawn` injection used by the web runtime; do not import a second process implementation in the entrypoint.

- [ ] **Step 4: Run helper and route tests**

  Run:

  ```bash
  bun test packages/web/server/lib/opencode/external-upgrade.test.js packages/web/server/lib/opencode/routes.test.js
  ```

  Expected: PASS.

---

### Task 3: Surface external update and restart semantics in the UI

**Files:**
- Modify: `packages/ui/src/components/update/OpenCodeUpdateToast.tsx`
- Modify: `packages/ui/src/components/sections/openchamber/AboutSettings.tsx` if the update action is exposed there
- Modify: `packages/ui/src/lib/i18n/messages/en.ts`
- Modify: every non-English file in `packages/ui/src/lib/i18n/messages/`

**Interfaces:**
- UI consumes `method` and `restartRequired` from `/api/opencode/upgrade`.
- UI continues using `runtimeFetch` and existing localized toast patterns.

- [ ] **Step 1: Add localized copy**

  Add complete translations for the external-update result and the required-restart warning in all locale dictionaries. Do not hardcode fallback English in components.

- [ ] **Step 2: Render the correct success message**

  When the response says `restartRequired: true`, tell the user that the CLI was updated but the external OpenCode server must be restarted by its own supervisor. Keep the existing reload action for re-probing; do not imply that OpenChamber restarted the external process.

- [ ] **Step 3: Run UI type-check and focused tests**

  Run:

  ```bash
  bun run --cwd packages/ui type-check
  bun test packages/ui/src/components/update/openCodeUpdateDedup.test.ts
  ```

  Expected: PASS.

---

### Task 4: Validate with an old external OpenCode installation

**Files:**
- Create: `packages/web/server/lib/opencode/fixtures/` only if a test fixture is needed
- Modify: no production files unless validation exposes a regression

- [ ] **Step 1: Install an isolated old OpenCode CLI**

  Use a temporary directory and the CLI's supported versioned upgrade/install mechanism. Do not modify the user's global `opencode` installation or the running server on port 4095.

- [ ] **Step 2: Start the old CLI as an external server**

  Run it on a disposable loopback port and start OpenChamber in `OPENCODE_SKIP_START=true` mode pointing at that server.

- [ ] **Step 3: Exercise the browser action**

  Use Playwright CLI to open the update UI, click the update action, verify the request succeeds through the CLI fallback, and verify the UI says that the external server needs a supervisor restart.

- [ ] **Step 4: Run repository gates**

  Run:

  ```bash
  bun run --cwd packages/web type-check
  bun run --cwd packages/ui type-check
  bun run --cwd packages/web lint
  bun run --cwd packages/ui lint
  git diff --check
  ```

  Expected: PASS; record any pre-existing failures separately.

---

### Task 5: Publish issue and pull request

**Files:**
- No additional source files

- [ ] **Step 1: Create the GitHub issue in `megamen32/openchamber`**

  Title: `feat: update locally managed external OpenCode installations`

  Body must describe the old-server `/global/upgrade` failure, the safe CLI fallback, local-only restriction, and restart responsibility.

- [ ] **Step 2: Commit only the feature branch changes**

  ```bash
  git add docs/superpowers/plans/2026-07-19-external-opencode-update.md packages/web/server packages/ui/src
  git commit -m "feat: update local external OpenCode installations"
  ```

- [ ] **Step 3: Push the clean branch and open a draft PR**

  Target `megamen32/openchamber:main`, link the issue with `Closes #<issue>`, and include focused tests plus the browser smoke result.

- [ ] **Step 4: Report links, branch, commit, and validation**

  Provide the issue URL, PR URL, clean branch name, test commands, and the exact limitation that external processes still require their own supervisor restart.
