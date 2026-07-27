# Task 4 Report

Date: 2026-07-27
Repository: `/home/roomhacker/agents-projects/apps/forks/openchamber`
Brief: `/home/roomhacker/agents-projects/apps/forks/openchamber/.superpowers/sdd/task-4-brief.md`

## Outcome

Implemented the Task 4 UI slice as discovery-only for Task/MCP actions, with an explicit visible unsupported state for direct invocation because the current OpenCode runtime does not expose a safe direct Task/MCP call contract.

Implemented native child-to-parent last-answer handoff using real session/message APIs only.

Did not invent or route through any fake Task/MCP endpoint.

## What changed

### Added

- `packages/ui/src/components/chat/ComposerToolMenu.tsx`
  - Dropdown menu for runtime-discovered Task and MCP actions.
  - Renders explicit `Unsupported` status plus the missing-contract message.

- `packages/ui/src/lib/opencode/tool-call-client.ts`
  - `listCallableActions(...)`
  - `callAction(...)`
  - `sendLastChildAnswerToParent(...)`
  - Uses runtime-proven discovery only:
    - Task discovery from visible subagent/all agents when `agentControlToolEnabled` is enabled
    - MCP discovery from runtime MCP status
  - Direct invocation intentionally rejects with:
    - `Direct Task/MCP invocation is not exposed by the current OpenCode runtime.`

- Tests
  - `packages/ui/src/components/chat/__tests__/composerToolMenu.test.tsx`
  - `packages/ui/src/lib/opencode/tool-call-client.test.ts`

### Updated

- `packages/ui/src/components/chat/ChatInput.tsx`
  - Mounts the composer Task/MCP menu in mobile and desktop footer controls.
  - Unsupported selections surface a visible toast instead of silently converting to text.

- `packages/ui/src/stores/useMcpStore.ts`
  - Added MCP discovery entry normalization helper for menu rendering.

- `packages/ui/src/lib/opencode/client.ts`
  - `getSessionMessages(...)` now accepts an explicit directory override so parent handoff can read the correct session stream without assuming the current runtime directory.

- `packages/ui/src/sync/session-actions.ts`
  - Added plain session-message send helper that reuses real optimistic send + real session send APIs for internal handoff.

- `packages/ui/src/components/chat/ChatMessage.tsx`
  - Adds child-session “send last child answer to parent” action wiring.

- `packages/ui/src/components/chat/message/MessageBody.tsx`
  - Accepts an injected assistant transfer action so the existing message action slot can host the parent handoff button.

## Test-first evidence

Added the new tests first and ran them in a failing state:

- `bun test packages/ui/src/lib/opencode/tool-call-client.test.ts packages/ui/src/components/chat/__tests__/composerToolMenu.test.tsx`
  - Initial result: failed because the new modules did not exist yet.

After implementation:

- `bun test packages/ui/src/lib/opencode/tool-call-client.test.ts packages/ui/src/components/chat/__tests__/composerToolMenu.test.tsx`
  - Final result: 6 passing, 0 failing.

## UI type-check

Ran:

- `bun run type-check:ui`

Result:

- Not clean at repository baseline.
- Task 4 local type issues were fixed during the run.
- Remaining failures are pre-existing/unrelated workspace errors, including:
  - missing i18n keys in `FailedTurnRecoveryControls.tsx`
  - incomplete localized message maps in multiple `src/lib/i18n/messages/*.ts`
  - unrelated resilience/recovery typing drift
  - unrelated OpenCode SDK typing drift in existing recovery helpers already present in the worktree

No attempt was made to fix those unrelated tracks because the task scope was limited to Task 4 in OpenChamber and the user explicitly asked not to broaden into OpenCode/OmniRoute work.

## Runtime-contract conclusion

Confirmed limitation:

- Direct Task/MCP invocation is still unsupported in the current runtime contract exposed to this client.
- Therefore the implemented menu is discovery-only and visibly unsupported for direct invocation.

Implemented supported path:

- Parent handoff uses the real child session → parent session relationship plus real session message read/send APIs.

## Concerns / follow-up

1. Direct Task/MCP execution remains blocked on a native OpenCode runtime contract that safely exposes callable action execution.
2. The repository UI type-check is currently red for unrelated baseline issues, so Task 4 cannot claim a fully clean UI type-check gate until those external errors are resolved.
