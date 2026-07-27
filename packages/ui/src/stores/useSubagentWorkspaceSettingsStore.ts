import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { createDeferredSafeJSONStorage } from './utils/safeStorage';

type SubagentWorkspaceSettingsState = {
  autoOpenSubagents: boolean;
  horizontalSubagentChats: boolean;
  setAutoOpenSubagents: (value: boolean) => void;
  setHorizontalSubagentChats: (value: boolean) => void;
};

/**
 * Stores user opt-ins for subagent-specific chat presentation.
 */
export const useSubagentWorkspaceSettingsStore = create<SubagentWorkspaceSettingsState>()(
  devtools(
    persist(
      (set) => ({
        autoOpenSubagents: false,
        horizontalSubagentChats: false,
        setAutoOpenSubagents: (value: boolean) => {
          set({ autoOpenSubagents: value });
        },
        setHorizontalSubagentChats: (value: boolean) => {
          set({ horizontalSubagentChats: value });
        },
      }),
      {
        name: 'openchamber-subagent-workspace-settings',
        version: 1,
        storage: createDeferredSafeJSONStorage(),
        partialize: (state) => ({
          autoOpenSubagents: state.autoOpenSubagents,
          horizontalSubagentChats: state.horizontalSubagentChats,
        }),
      },
    ),
    { name: 'SubagentWorkspaceSettingsStore' },
  ),
);
