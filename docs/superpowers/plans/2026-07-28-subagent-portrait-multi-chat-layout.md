# Subagent Portrait Multi-Chat Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in OpenChamber workspace that shows the parent chat and its direct subagent chats as several independent full-height portrait chat panes visible side-by-side on one screen.

**Architecture:** Reuse OpenChamber's existing same-origin embedded session-chat iframe route instead of rendering several copies of the global `ChatContainer` state in one React tree. The main chat shell becomes a portrait pane grid when the setting is enabled; each iframe owns one session's existing chat, composer, scrolling, recovery controls, and model state. The current single-chat behavior remains unchanged when the setting is disabled or when the app is running inside an embedded pane.

**Tech Stack:** React, TypeScript, Tailwind utility classes, `@opencode-ai/sdk/v2`, existing `ocPanel=session-chat` iframe bootstrap, Bun tests.

## Global Constraints

- The feature is opt-in and defaults to `false`.
- This is a multi-pane layout, not a horizontal preview-card strip, carousel, or tab switcher.
- Every pane is an independent vertical chat with its own message scroll and composer.
- The parent session is the first pane; direct child subagent sessions follow it in recency order.
- Panes remain visible at the same time; horizontal overflow is allowed only when the pane count exceeds available width.
- The existing embedded-session route must not recursively render another multi-pane workspace.
- Narrow/mobile and VS Code surfaces keep the existing single-chat behavior until a separate responsive design is implemented.
- The 16:9 desktop acceptance target is four usable portrait panes when the viewport width permits; more panes remain horizontally scrollable.

---

### Task 1: Define the pane list and layout contract

**Files:**
- Modify: `packages/ui/src/components/session/subagentWorkspaceLogic.ts`
- Modify: `packages/ui/src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx`

**Interfaces:**
- Add `getSubagentWorkspaceSessions(sessions, anchorSessionId): Session[]`, returning the anchor session followed by direct children from `getDirectChildSessions`.
- Add `getPortraitPaneWidthClass()` only if the existing class-string conventions need a shared value; otherwise keep the responsive classes in the component.
- Keep `getDirectChildSessions`, `pickAutoOpenSubagentSession`, `reconcileKnownChildSessionIds`, and `getWorkspaceStripScrollDelta` behavior-compatible for existing callers.

- [ ] **Step 1: Write failing logic tests**

```ts
test('builds a workspace with the parent first and direct children after it', () => {
  const sessions = [
    session('child-old', { parentID: 'parent', updated: 10 }),
    session('parent', { updated: 1 }),
    session('child-new', { parentID: 'parent', updated: 20 }),
    session('grandchild', { parentID: 'child-new', updated: 30 }),
  ];

  expect(getSubagentWorkspaceSessions(sessions, 'parent').map((item) => item.id))
    .toEqual(['parent', 'child-new', 'child-old']);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `packages/ui`:

```bash
bun test src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx
```

Expected: FAIL because the workspace-session selector does not exist yet.

- [ ] **Step 3: Implement the smallest selector**

Use the existing direct-child recency comparator, prepend the exact anchor session when present, and exclude grandchildren from this first-level workspace.

- [ ] **Step 4: Run the focused test**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx
```

Expected: PASS, including the pre-existing auto-open and scroll-helper tests.

- [ ] **Step 5: Commit the logic slice**

```bash
git add packages/ui/src/components/session/subagentWorkspaceLogic.ts packages/ui/src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx
git commit -m "test(ui): define portrait subagent workspace sessions"
```

### Task 2: Build the independent portrait-pane grid

**Files:**
- Create: `packages/ui/src/components/session/SubagentWorkspaceGrid.tsx`
- Create: `packages/ui/src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx`
- Reuse without changing: `packages/ui/src/components/layout/contextPanelEmbeddedChat.ts`
- Reference: `packages/ui/src/components/layout/ContextPanel.tsx`

**Interfaces:**
- Export `SubagentWorkspaceGrid` with props `{ anchorSessionId: string; activeSessionId: string | null; directory: string | null; onFocusSession: (sessionId: string, directory: string | null) => void }`.
- Build each pane URL through `buildEmbeddedSessionChatURL(sessionID, directory, false, themeBootstrap)`.
- Use `useThemeSystem()` to provide the same `{ mode, lightThemeId, darkThemeId, currentTheme }` bootstrap already used by `ContextPanel`.

- [ ] **Step 1: Write failing component-contract tests**

```tsx
test('renders the parent and every direct child as visible iframe panes', () => {
  render(<SubagentWorkspaceGrid anchorSessionId="parent" activeSessionId="parent" directory="/repo" onFocusSession={vi.fn()} />);

  expect(screen.getAllByTitle(/session chat/i)).toHaveLength(3);
  expect(screen.getByTestId('subagent-pane-parent')).toBeVisible();
  expect(screen.getByTestId('subagent-pane-child-a')).toBeVisible();
  expect(screen.getByTestId('subagent-pane-child-b')).toBeVisible();
});

test('does not use a preview-card click to replace the visible pane set', () => {
  render(<SubagentWorkspaceGrid anchorSessionId="parent" activeSessionId="child-a" directory="/repo" onFocusSession={vi.fn()} />);

  expect(screen.getAllByTitle(/session chat/i)).toHaveLength(3);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx
```

Expected: FAIL because the grid component and pane markup do not exist.

- [ ] **Step 3: Implement the grid**

Render a full-height horizontal container with `overflow-x-auto`, `overflow-y-hidden`, and one flex item per session. Each item must contain a visible pane header with the exact model/session identity available to the embedded chat, plus an iframe using the existing session-chat URL. Use a responsive portrait-oriented pane width that targets four panes on a wide 16:9 desktop and preserves horizontal scrolling for additional panes. Do not render `SubagentWorkspaceStrip` preview cards in this mode.

The iframe must receive a stable key based on session ID and directory, and the grid must keep all iframe `src` values stable across active-pane changes so typing and scroll state are not reset unnecessarily. A pane focus action may update the parent active-session indicator, but it must not remove sibling panes.

- [ ] **Step 4: Run the focused test**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the grid slice**

```bash
git add packages/ui/src/components/session/SubagentWorkspaceGrid.tsx packages/ui/src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx
git commit -m "feat(ui): add portrait subagent chat grid"
```

### Task 3: Replace the misleading strip integration

**Files:**
- Modify: `packages/ui/src/components/chat/ChatContainer.tsx`
- Modify: `packages/ui/src/components/session/SubagentWorkspaceStrip.tsx` only if its old preview strip becomes unused
- Modify: `packages/ui/src/components/layout/contextPanelEmbeddedChat.ts` only if the existing URL cache needs a narrow grid-specific helper

**Interfaces:**
- Keep the existing `autoOpenSubagents` behavior and its setting store unchanged.
- Replace the `horizontalSubagentChats` branch that currently renders `SubagentWorkspaceStrip` with `SubagentWorkspaceGrid`.
- Guard the grid with `!isEmbeddedSessionChat()` so each iframe renders exactly one session and does not recursively mount another grid.

- [ ] **Step 1: Add a failing integration assertion**

Extend the existing session workspace tests so the opt-in branch asserts a grid with the anchor and child pane IDs, while the embedded-session branch asserts no nested grid.

- [ ] **Step 2: Run the focused integration tests and verify the new assertion fails**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx src/components/layout/contextPanelEmbeddedChat.test.tsx
```

Expected: FAIL until `ChatContainer` selects the grid and suppresses nested rendering.

- [ ] **Step 3: Integrate the grid as the active desktop workspace**

Use the current `workspaceAnchorSessionId` (`parentSession?.id ?? currentSessionId`) and the current directory. When the grid is active, render it as the chat surface for an existing session instead of rendering the old preview strip plus a second single chat underneath. Preserve the draft, loading, error, return-to-parent, and mobile/VS Code branches.

- [ ] **Step 4: Run focused integration tests**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx src/components/layout/contextPanelEmbeddedChat.test.tsx
```

Expected: PASS with no recursive iframe/grid behavior.

- [ ] **Step 5: Commit the integration slice**

```bash
git add packages/ui/src/components/chat/ChatContainer.tsx packages/ui/src/components/session/SubagentWorkspaceStrip.tsx packages/ui/src/components/layout/contextPanelEmbeddedChat.ts
git commit -m "feat(ui): integrate portrait subagent workspace"
```

### Task 4: Make the setting describe the real behavior

**Files:**
- Modify: `packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx`
- Modify: `packages/ui/src/lib/i18n/messages/en.ts` if the final copy is moved into locale keys
- Modify: `packages/ui/src/lib/i18n/messages/ru.ts` if the Russian UI copy is present there

- [ ] **Step 1: Replace the misleading label**

The setting must say that it opens a multi-chat portrait workspace, not merely “horizontal subagent chats” or “strip”. Keep it opt-in and preserve its persisted key for migration safety.

- [ ] **Step 2: Run the settings-focused test/build check**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx
bun run typecheck
```

Expected: PASS from the `packages/ui` package.

- [ ] **Step 3: Commit the settings-copy slice**

```bash
git add packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx packages/ui/src/lib/i18n/messages/en.ts packages/ui/src/lib/i18n/messages/ru.ts
git commit -m "docs(ui): clarify portrait subagent workspace setting"
```

### Task 5: Validate the user-visible layout

**Files:**
- No new source files.
- Validate: `packages/ui/src/components/session/SubagentWorkspaceGrid.tsx`, `packages/ui/src/components/chat/ChatContainer.tsx`, and the embedded session-chat route.

- [ ] **Step 1: Run the complete focused UI suite**

```bash
bun test src/components/session/__tests__/SubagentWorkspaceGrid.test.tsx src/components/session/__tests__/SubagentWorkspaceStrip.test.tsx src/components/layout/contextPanelEmbeddedChat.test.tsx
bun run typecheck
```

- [ ] **Step 2: Verify desktop acceptance behavior**

With the setting enabled and one parent plus at least three direct subagents:

1. Confirm all panes are visible simultaneously in one horizontal row.
2. Confirm each pane is independently vertically scrollable and has its own composer.
3. Confirm typing or streaming in one pane does not replace or navigate away from sibling panes.
4. Confirm adding a new direct subagent adds one pane without collapsing the existing panes.
5. Confirm more panes are reachable by horizontal scrolling, not by a tab switcher.
6. Confirm an embedded pane does not contain a second nested workspace.
7. Disable the setting and confirm the existing single-chat layout returns.

- [ ] **Step 3: Commit the verified milestone**

```bash
git add packages/ui/src/components/session packages/ui/src/components/chat/ChatContainer.tsx packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx packages/ui/src/lib/i18n/messages
git commit -m "feat(ui): complete portrait multi-chat workspace"
```

## Known prerequisite outside this layout plan

The current resilience settings failure is a separate blocker: `GET /global/config` returns `400` because the installed OmniRoute catalog contains a model with an empty `limit` object while OpenCode's config schema requires `limit.context` whenever `limit` is present. The resilience UI then falls back to `0` values. That must be fixed and separately tested before claiming resilience settings persistence or effective timeout display.
