import { create } from 'zustand';
import type { AppSettings } from '@/types/models';
import { defaultSettings } from '@/lib/factories';
import { queueSetting } from '@/db/persistence';

interface SettingsStore {
  settings: AppSettings;
  hydrate: (settings: AppSettings) => void;
  update: (patch: Partial<AppSettings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: defaultSettings(),
  hydrate: (settings) => set({ settings }),
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    queueSetting('app', settings);
  },
}));
