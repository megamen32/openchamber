# Task 3 report — OpenCode reliability settings surface

Date: 2026-07-27
Repository: `/home/roomhacker/agents-projects/apps/forks/openchamber`
Brief: `/home/roomhacker/agents-projects/apps/forks/openchamber/.superpowers/sdd/task-3-brief.md`
Base commit: `b2a4415531760261159f2c7e9035e49ee5123858`

## Outcome

Implemented a persisted OpenChamber resilience settings surface for:

- `autoResume`
- `retries`
- `retryDelayMs`
- `responseTimeoutMs`
- `toolTimeoutMs`
- `fallbackEnabled`
- ordered `fallbackModelIds`

The implementation uses the existing runtime/directory-scoped settings bridge only:

- load via the registered runtime settings API when present, else `/api/config/settings`
- save via existing desktop settings persistence
- directory-scoped fallback model discovery via existing provider/config lookup

No second server was added. No unrelated global config file was introduced.

## TDD evidence

### 1. Failing tests added first

Added:

- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/stores/useResilienceSettingsStore.test.ts`
- regression case in `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/web/server/lib/opencode/settings-helpers.test.js`

Initial red evidence:

- `bun test packages/ui/src/stores/useResilienceSettingsStore.test.ts`
  - failed because `./useResilienceSettingsStore` did not exist yet
- bridge sanitizer regression test initially failed because resilience fields were dropped from `sanitizeSettingsUpdate`

### 2. Implemented slice

Created:

- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/stores/useResilienceSettingsStore.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/sections/openchamber/ResilienceSettings.tsx`

Modified:

- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/components/sections/openchamber/OpenChamberPage.tsx`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/api/types.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/desktop.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/persistence.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/settings/search.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/en.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/es.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/ja.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/ko.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/pl.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/pt-BR.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/uk.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/zh-CN.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/ui/src/lib/i18n/messages/zh-TW.settings.ts`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/web/server/lib/opencode/settings-helpers.js`
- `/home/roomhacker/agents-projects/apps/forks/openchamber/packages/web/server/lib/opencode/settings-helpers.test.js`

## Behavior implemented

- Store loads and saves resilience settings per active runtime.
- Async load/save results are invalidated across runtime switches.
- Pending writes from an old runtime cannot overwrite a newer runtime state.
- Fallback model suggestions are discovered from the existing directory-scoped provider/config API.
- UI copy explicitly states changes affect the next request only.
- Shared `/api/config/settings` sanitizer now round-trips the resilience fields instead of dropping them.

## Verification

Passed:

- `bun test packages/ui/src/stores/useResilienceSettingsStore.test.ts`
  - `3 pass, 0 fail`
- `bun test packages/web/server/lib/opencode/settings-helpers.test.js`
  - `32 pass, 0 fail`

UI type-check executed:

- `bun run --cwd packages/ui type-check`

Result:

- failed, but remaining errors are outside this resilience slice and come from unrelated dirty work already present in the checkout, including:
  - `src/components/chat/__tests__/failedMessageRecovery.test.tsx`
  - `src/lib/i18n/bootstrap.ts`
  - `src/lib/i18n/intl.ts`
  - `src/lib/opencode/client.ts`
  - `src/sync/session-recovery-actions.test.ts`

After resilience fixes, the compiler blockers no longer point at:

- `useResilienceSettingsStore.ts`
- `ResilienceSettings.tsx`
- resilience bridge sanitizer changes

## Scope boundary and missing runtime contract

This change persists and exposes resilience preferences through the existing OpenChamber runtime settings bridge only.

I did not claim server-side enforcement of retries, timeouts, fallback order, or automatic resume inside OpenCode itself because this repository slice does not provide evidence of that enforcement contract. The implemented and tested boundary is:

- OpenChamber UI/store persistence
- bridge acceptance and round-tripping of the fields
- next-request-only user messaging

## Noted mismatch in the brief

The brief names `packages/ui/src/lib/i18n/messages/ru.settings.ts`, but this checkout does not contain that file. The package also currently has broader missing-`ru` type-check errors in unrelated i18n files, which is consistent with the missing locale wiring being a pre-existing repository issue rather than part of this resilience slice.
