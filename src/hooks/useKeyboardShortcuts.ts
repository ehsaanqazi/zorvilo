import { useEffect } from 'react';
import { useUi } from '@/store/ui';
import { useTabs } from '@/store/tabs';
import { useData } from '@/store/data';
import { executeTab } from '@/features/http/execute';

/**
 * Global shortcuts:
 *   Ctrl+K       command palette          Ctrl+Enter   send request
 *   Ctrl+N       new request              Ctrl+S       save draft to collection
 *   Ctrl+W       close tab                Ctrl+Tab     next tab (Shift = previous)
 *   Ctrl+D       duplicate tab            Ctrl+,       settings
 *   Ctrl+B       toggle sidebar           Ctrl+L       focus URL
 *   Ctrl+Shift+N new collection           Ctrl+E       environments
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const ui = useUi.getState();
      const tabs = useTabs.getState();
      const activeTabId = ui.ui.activeTabId;
      const key = e.key.toLowerCase();

      const cycleTab = (dir: 1 | -1) => {
        const ordered = [...tabs.tabs].sort((a, b) => a.sortOrder - b.sortOrder);
        if (ordered.length === 0) return;
        const idx = ordered.findIndex((t) => t.id === activeTabId);
        const next = ordered[(idx + dir + ordered.length) % ordered.length];
        if (next) tabs.activate(next.id);
      };

      switch (key) {
        case 'k':
          e.preventDefault();
          ui.setPaletteOpen(!ui.paletteOpen);
          break;
        case 'enter':
          if (activeTabId) {
            e.preventDefault();
            void executeTab(activeTabId);
          }
          break;
        case 'n':
          e.preventDefault();
          if (e.shiftKey) {
            useData.getState().createCollection(ui.ui.activeWorkspaceId, 'New Collection');
          } else {
            tabs.openDraft();
          }
          break;
        case 's':
          e.preventDefault();
          if (activeTabId) {
            const tab = tabs.tabs.find((t) => t.id === activeTabId);
            if (tab?.draft) ui.setDialog('saveRequest', activeTabId);
            // saved requests persist automatically — nothing else to do
          }
          break;
        case 'w':
          if (activeTabId) {
            e.preventDefault();
            tabs.requestClose(activeTabId);
          }
          break;
        case 'd':
          if (activeTabId) {
            e.preventDefault();
            tabs.duplicate(activeTabId);
          }
          break;
        case ',':
          e.preventDefault();
          ui.setDialog('settings');
          break;
        case 'b':
          e.preventDefault();
          ui.update({ sidebarCollapsed: !ui.ui.sidebarCollapsed });
          break;
        case 'e':
          e.preventDefault();
          ui.setDialog('environments');
          break;
        case 'l': {
          e.preventDefault();
          const url = document.querySelector<HTMLInputElement>('[data-url-input]');
          url?.focus();
          url?.select();
          break;
        }
        case 'tab':
          e.preventDefault();
          cycleTab(e.shiftKey ? -1 : 1);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
