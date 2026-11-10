import { askText } from '@/store/ui';
import { useWorkspaces } from '@/store/workspaces';

/** Ask for a name in a modal, then create the workspace and switch to it. */
export async function promptCreateWorkspace(initialName = ''): Promise<void> {
  const name = await askText('Create workspace', 'Workspace name', initialName, {
    description: 'Each workspace has its own collections, environments, history and Git repo.',
    confirmLabel: 'Create',
    monospace: false,
    required: true,
  });
  const trimmed = name?.trim();
  if (!trimmed) return;
  const { create, switchTo } = useWorkspaces.getState();
  const ws = await create(trimmed);
  await switchTo(ws.id);
}
