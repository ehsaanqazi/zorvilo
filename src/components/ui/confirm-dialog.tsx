import * as React from 'react';
import { CircleHelp, TriangleAlert } from 'lucide-react';
import { useUi } from '@/store/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Global confirmation modal for destructive actions (permanent deletes, hard pulls). */
export function ConfirmDialog() {
  const confirmState = useUi((s) => s.confirmState);
  const closeConfirm = useUi((s) => s.closeConfirm);

  if (!confirmState) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && closeConfirm()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-destructive" />
            {confirmState.title}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            {confirmState.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={closeConfirm}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            autoFocus
            onClick={() => {
              closeConfirm();
              confirmState.onConfirm();
            }}
          >
            {confirmState.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Global multi-option prompt (e.g. import name conflicts: replace / keep both / cancel). */
export function ChoiceDialog() {
  const choiceState = useUi((s) => s.choiceState);
  const resolveChoice = useUi((s) => s.resolveChoice);

  if (!choiceState) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && resolveChoice(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleHelp className="size-4 text-amber-500" />
            {choiceState.title}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-relaxed">
            {choiceState.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolveChoice(null)}>
            Cancel
          </Button>
          {choiceState.options.map((option) => (
            <Button
              key={option.value}
              variant={option.variant ?? 'default'}
              onClick={() => resolveChoice(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Global single-line text prompt (in-app replacement for window.prompt). */
export function TextPromptDialog() {
  const prompt = useUi((s) => s.textPrompt);
  const resolveText = useUi((s) => s.resolveText);
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (prompt) setValue(prompt.initialValue ?? '');
  }, [prompt]);

  if (!prompt) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && resolveText(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt.title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resolveText(value);
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            value={value}
            placeholder={prompt.placeholder}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resolveText(null)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
