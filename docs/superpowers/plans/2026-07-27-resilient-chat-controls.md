# Resilient Chat Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable recovery controls, next-request model switching, configurable OpenCode resilience, explicit Task/MCP actions, and opt-in subagent workspace controls to the OpenChamber/OpenCode stack.

**Architecture:** OpenChamber owns user-facing state, buttons, menus, and persisted opt-in preferences. OpenCode owns server-side request/tool timeout and retry policy because a browser cannot cancel or time-limit work already running in the server. The UI calls the existing OpenCode `session.switchModel` and `session.prompt(..., resume)` contracts, and uses a small explicit tool-call bridge for operations that OpenCode does not expose as public HTTP endpoints; no second OpenCode server is started.

**Tech Stack:** TypeScript, React, Zustand, OpenCode v2 SDK/generated client, Effect schemas/runtime, Vitest/Bun tests, existing OpenChamber i18n and UI primitives.

## Global Constraints

- Preserve raw provider/model IDs everywhere; model labels used by these controls must remain identifiers such as `minimax/MiniMax-M3:512k`, never humanized names with spaces.
- Changing the model while a turn is active updates only the next request; it must not mutate the model of an already-running request.
- Resume/retry must use an explicit message ID or the OpenCode `resume` contract; never blindly repeat an uncertain `promptAsync` transport request that may already be running server-side.
- Automatic retry is bounded by configured attempts and delay; fallback is opt-in, deterministic, and recorded with the actual provider/model used.
- If a combo model is selected, displayed context and modalities must be the minimum supported by every member of the combo; actual responding model metadata remains visible in the raw ID form.
- Settings are scoped to the active OpenCode runtime/directory where the existing persistence layer supports scope; defaults are opt-in unless stated P0.
- The existing systemd-owned OpenCode server remains the only server; verification must target its configured endpoint and must not launch a competing daemon.
- Every implementation task starts with a failing focused test, runs the smallest relevant test command, and leaves unrelated dirty files untouched.

---

## Repository and file map

OpenChamber fork (`/home/roomhacker/agents-projects/apps/forks/openchamber`) is the primary UI product. Relevant existing surfaces are `packages/ui/src/components/chat/ChatMessage.tsx`, `ChatInput.tsx`, `ChatContainer.tsx`, `MessageList.tsx`, `packages/ui/src/sync/session-actions.ts`, `packages/ui/src/lib/opencode/client.ts`, `packages/ui/src/stores/useConfigStore.ts`, `useMcpStore.ts`, and the OpenChamber settings/i18n files. The current retry state is already represented by `sessionStatus.type === "retry"` and `applyRetryOverlay`.

OpenCode fork (`/home/roomhacker/agents-projects/apps/forks/opencode`) owns the server-side configuration/runtime changes. Relevant existing surfaces are `packages/core/src/config.ts`, `packages/core/src/config/mcp.ts`, `packages/core/src/aisdk.ts`, `packages/core/src/session.ts`, `packages/core/src/session/runner`, `packages/server/src/handlers/session.ts`, and generated v2 client/schema files.

The OmniRoute plugin (`/home/roomhacker/agents-projects/opencode-omniroute-models`) is not the UI owner. It may only receive a narrowly scoped hook if recovery telemetry or actual-combo metadata needs to cross the provider boundary; model catalog IDs and metadata must not be duplicated in OpenChamber.

### Task 1: OpenCode resilience configuration and runtime contract (P0/P1)

**Files:**
- Create: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/core/src/config/resilience.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/core/src/config.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/core/src/aisdk.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/core/src/session.ts` and the narrow runner module that owns the model/tool loop
- Modify: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/server/src/handlers/session.ts` only if the bridge endpoint needs server routing
- Test: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/core/test/resilience-config.test.ts`
- Test: `/home/roomhacker/agents-projects/apps/forks/opencode/packages/core/test/session-resilience.test.ts`

**Interfaces:**
- Produce `Config.Resilience` with `responseTimeoutMs`, `toolTimeoutMs`, `retries`, `retryDelayMs`, `autoResume`, and ordered `fallbackModels: string[]`; validate non-negative retries/delays and positive enabled timeouts.
- Produce a runtime result/error shape that preserves `attempt`, `selectedModel`, `actualModel`, and `fallbackUsed` for session events/UI metadata.
- Preserve existing MCP startup/request timeout fields; `toolTimeoutMs` is the session tool execution ceiling, not a replacement for MCP server timeout.

- [ ] **Step 1: Write failing schema and default tests.** Assert absent config decodes to safe defaults, invalid negative values fail, and fallback model IDs retain exact strings including `minimax/MiniMax-M3:512k`.
- [ ] **Step 2: Run `bun test packages/core/test/resilience-config.test.ts` and verify failure.**
- [ ] **Step 3: Add the schema, wire it into `Config.Info`, and apply the response timeout to the provider fetch/stream boundary and tool timeout to local tool settlement.** Retry only retryable failures, sleep exactly the configured delay between attempts, then select the next ordered fallback model; publish actual-model metadata.
- [ ] **Step 4: Add session runtime tests for bounded retries, fallback order, timeout classification, and no retry after a committed/uncertain request.**
- [ ] **Step 5: Run `bun test packages/core/test/resilience-config.test.ts packages/core/test/session-resilience.test.ts` and `bun run --cwd packages/core type-check`; commit as `feat: add OpenCode resilience controls`.

### Task 2: Failed-message recovery actions and next-request model switching (P0/P1)

**Files:**
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/sync/session-recovery-actions.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/ChatMessage.tsx`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/MessageList.tsx` and `packages/ui/src/components/chat/lib/turns/applyRetryOverlay.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/opencode/client.ts`
- Test: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/sync/session-recovery-actions.test.ts`
- Test: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/__tests__/failedMessageRecovery.test.tsx`

**Interfaces:**
- Produce `recoverFailedTurn(input: { sessionId: string; mode: "resume" | "restart"; providerID?: string; modelID?: string; variant?: string }): Promise<void>`.
- `resume` uses the existing session prompt with `resume: true` after the active operation is confirmed idle; `restart` interrupts stale work, then replays the last user turn with an explicit generated message ID.
- Produce `switchModelForNextRequest(sessionId: string, selection: ModelSelection): Promise<void>` using `session.switchModel`; active stream state is never rewritten.
- Render raw `providerID/modelID` and optional variant in the error card, with buttons `Возобновить`, `Перезапуск`, and an opt-in model dropdown.

- [ ] **Step 1: Add failing action tests for resume, restart, model selection, and duplicate-send protection.**
- [ ] **Step 2: Run the two focused tests and verify they fail.**
- [ ] **Step 3: Implement recovery actions against the existing session directory-aware client and store; preserve attachments/input text when a send fails.
- [ ] **Step 4: Render actions exactly where `SessionRetry`/assistant errors are displayed and add i18n entries for English and Russian (other locales use the existing fallback mechanism).
- [ ] **Step 5: Run focused UI tests and `bun run --cwd packages/ui type-check`; commit as `feat: add failed-turn recovery controls`.

### Task 3: OpenCode reliability settings surface (P1) and automatic retry/fallback toggle (P0)

**Files:**
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/stores/useResilienceSettingsStore.ts`
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/sections/openchamber/ResilienceSettings.tsx`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/sections/openchamber/OpenCodeCliSettings.tsx` or the settings section registry that owns OpenCode settings
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/persistence.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/en.settings.ts` and `packages/ui/src/lib/i18n/messages/ru.settings.ts`
- Test: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/stores/useResilienceSettingsStore.test.ts`

**Interfaces:**
- Persist `autoResume`, `retries`, `retryDelayMs`, `responseTimeoutMs`, `toolTimeoutMs`, `fallbackEnabled`, and ordered fallback model IDs.
- Send settings to the OpenCode runtime through the explicit config API/bridge from Task 1; changing values while busy affects the next request only.
- Expose separate controls for “automatic resume/retry”, “fallback”, max AI response wait, max tool wait, retry count, and wait between retries.

- [ ] **Step 1: Write failing persistence tests, including runtime/directory isolation and next-request semantics.**
- [ ] **Step 2: Run `bun test packages/ui/src/stores/useResilienceSettingsStore.test.ts` and verify failure.**
- [ ] **Step 3: Implement the store/settings section using existing settings primitives and API fetch patterns; do not add a second server or write directly to an unrelated global config file.
- [ ] **Step 4: Run focused tests and UI type-check; commit as `feat: expose resilience settings`.

### Task 4: Composer Task/MCP call menu and parent handoff (P1/P2)

**Files:**
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/ComposerToolMenu.tsx`
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/opencode/tool-call-client.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/ChatInput.tsx`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/sync/session-actions.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/opencode/client.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/stores/useMcpStore.ts`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/ChatMessage.tsx`
- Test: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/__tests__/composerToolMenu.test.tsx`
- Test: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/opencode/tool-call-client.test.ts`

**Interfaces:**
- `listCallableActions(sessionId, directory): Promise<Array<{ kind: "task" | "mcp"; id: string; label: string; inputSchema?: unknown }>>` returns only actions proven available by the runtime.
- `callAction(input: { sessionId: string; actionId: string; arguments: Record<string, unknown>; directory?: string }): Promise<void>` calls the explicit bridge and records the result in the current session; unsupported direct calls fail visibly.
- `sendLastChildAnswerToParent(childSessionId, directory): Promise<void>` finds the native parent, extracts the latest completed assistant text, and sends it to the parent with raw model metadata.

- [ ] **Step 1: Add failing client tests for Task discovery, MCP discovery, argument validation, unsupported action errors, and parent handoff.
- [ ] **Step 2: Run focused tests and verify failure.
- [ ] **Step 3: Implement the bridge only for actions actually exposed by the runtime; load MCP status and Task/subagent capability data rather than hard-coding fake entries.
- [ ] **Step 4: Add the composer dropdown at the message input and a “Send to parent” action in a child session’s message actions; keep the menu keyboard accessible.
- [ ] **Step 5: Run focused tests and UI type-check; commit as `feat: add composer tool actions`.

### Task 5: Opt-in subagent presentation and horizontal workspace (P2)

**Files:**
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/stores/useSubagentWorkspaceSettingsStore.ts`
- Create: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/session/SubagentWorkspaceStrip.tsx`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/chat/ChatContainer.tsx`
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/layout/RightSidebar.tsx` only if the existing panel contract requires it
- Test: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx`

**Interfaces:**
- Persist opt-ins `autoOpenSubagents` and `horizontalSubagentChats` with default `false`.
- Consume the existing child-session topology and render one horizontally scrollable strip of child chats, preserving normal session navigation and read-only/parent permissions.

- [ ] **Step 1: Add failing tests for defaults, auto-open on child creation, horizontal keyboard/trackpad navigation, and cleanup when a child disappears.
- [ ] **Step 2: Run focused tests and verify failure.
- [ ] **Step 3: Implement the strip using the existing child store/session navigation; do not create duplicate message stores.
- [ ] **Step 4: Wire the two opt-in toggles into Settings and run focused tests/type-check; commit as `feat: add opt-in subagent workspace`.

### Task 6: Integration, runtime verification, and release evidence

**Files:**
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/en.ts` and Russian equivalents for chat controls
- Modify: `/home/roomhacker/agents-projects/apps/forks/openchamber/docs/superpowers/plans/2026-07-27-resilient-chat-controls.md` to record completed checkboxes and evidence
- Test: existing OpenChamber UI sync/session tests plus OpenCode core resilience tests

- [ ] **Step 1: Run the focused suites for Tasks 1–5.
- [ ] **Step 2: Run `bun run type-check` in both forks and `bun run build:web` in OpenChamber.
- [ ] **Step 3: Verify the single systemd OpenCode endpoint, OpenChamber’s configured endpoint, one failed/recovered request, model switch on the next request, and raw actual-model metadata in the rendered message. Do not claim live acceptance from build output alone.
- [ ] **Step 4: Inspect `git diff --check`, confirm no secrets or unrelated artifacts, and record exact commit IDs and runtime evidence.

## Execution order

After this plan is accepted, Tasks 1–5 are dispatched in parallel only after their write sets are confirmed disjoint. Task 6 runs after the workers return because it depends on all contracts. Each worker must report changed files, focused test command/output, and unresolved concerns; the lead integrates and performs final acceptance.
