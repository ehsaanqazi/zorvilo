import * as React from 'react';
import { useUi } from '@/store/ui';
import { useTabs } from '@/store/tabs';
import { useSettings } from '@/store/settings';
import { getTabRequest } from '@/features/http/execute';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** "Save request before closing?" — with a remember-my-choice option. */
export function CloseTabDialog() {
  const tabId = useUi((s) => s.closeTabPromptId);
  const setCloseTabPrompt = useUi((s) => s.setCloseTabPrompt);
  const setSaveRequestCloseAfter = useUi((s) => s.setSaveRequestCloseAfter);
  const setDialog = useUi((s) => s.setDialog);
  const updateSettings = useSettings((s) => s.update);
  const close = useTabs((s) => s.close);
  const [remember, setRemember] = React.useState(false);

  React.useEffect(() => {
    if (tabId) setRemember(false);
  }, [tabId]);

  if (!tabId) return null;
  const request = getTabRequest(tabId);

  const dontSave = () => {
    if (remember) updateSettings({ closeDraftBehavior: 'discard' });
    setCloseTabPrompt(null);
    close(tabId);
  };

  const save = () => {
    if (remember) updateSettings({ closeDraftBehavior: 'save' });
    setCloseTabPrompt(null);
    setSaveRequestCloseAfter(true);
    setDialog('saveRequest', tabId);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && setCloseTabPrompt(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save request before closing?</DialogTitle>
          <DialogDescription>
            “{request?.name ?? 'This request'}” has not been saved to a collection. Unsaved
            requests are lost when the tab closes.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          Remember my choice (change it later in Settings)
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={dontSave}>
            Don't save
          </Button>
          <Button variant="outline" onClick={() => setCloseTabPrompt(null)}>
            Cancel
          </Button>
          <Button onClick={save}>Save…</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
