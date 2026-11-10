import { Columns2, Send, X } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useTabs } from '@/store/tabs';
import { useData } from '@/store/data';
import { Splitter } from './Splitter';
import { cn, methodColorClass } from '@/lib/utils';
import { TabBar } from '@/components/tabs/TabBar';
import { RequestView } from '@/components/request/RequestView';
import { CollectionView } from '@/components/collection/CollectionView';
import { EnvironmentSelector } from '@/components/environments/EnvironmentSelector';
import { SyncButton } from '@/components/git/SyncButton';
import { Button } from '@/components/ui/button';
import { EmptyState, Kbd } from '@/components/ui/misc';

function TabPane({ tab }: { tab: NonNullable<ReturnType<typeof useTabs.getState>['tabs'][number]> }) {
  return tab.kind === 'collection' ? (
    <CollectionView key={tab.id} collectionId={tab.requestId} />
  ) : (
    <RequestView key={tab.id} tabId={tab.id} />
  );
}

function SplitPaneHeader({ tabId }: { tabId: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const request = useData((s) => (tab?.draft ? tab.draft : s.requests[tab?.requestId ?? '']));
  const collection = useData((s) =>
    tab?.kind === 'collection' ? s.collections[tab.requestId] : undefined,
  );
  const update = useUi((s) => s.update);
  const title = tab?.kind === 'collection' ? collection?.name : request?.name;

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-2 text-xs">
      <Columns2 className="size-3.5 text-muted-foreground" />
      {tab?.kind !== 'collection' && request && (
        <span className={cn('text-[10px] font-bold', methodColorClass(request.method))}>
          {request.method}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{title ?? 'Split view'}</span>
      <Button variant="ghost" size="iconSm" title="Close split view" onClick={() => update({ splitTabId: null })}>
        <X />
      </Button>
    </div>
  );
}

export function MainArea() {
  const activeTabId = useUi((s) => s.ui.activeTabId);
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === activeTabId));
  const splitTabId = useUi((s) => s.ui.splitTabId);
  const splitTab = useTabs((s) => s.tabs.find((t) => t.id === splitTabId));
  const splitRatio = useUi((s) => s.ui.splitRatio);
  const update = useUi((s) => s.update);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-stretch border-b bg-card">
        <TabBar />
        <div className="flex shrink-0 items-center gap-1 px-2">
          <EnvironmentSelector />
          <SyncButton />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {activeTab ? (
          splitTab && splitTab.id !== activeTab.id ? (
            <>
              <div style={{ width: `${splitRatio * 100}%` }} className="min-w-40">
                <TabPane tab={activeTab} />
              </div>
              <Splitter
                orientation="vertical"
                onDrag={(delta) => {
                  const w = window.innerWidth || 1200;
                  update({
                    splitRatio: Math.min(0.8, Math.max(0.2, splitRatio + delta / w)),
                  });
                }}
              />
              <div className="flex min-w-40 flex-1 flex-col">
                <SplitPaneHeader tabId={splitTab.id} />
                <div className="min-h-0 flex-1">
                  <TabPane tab={splitTab} />
                </div>
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <TabPane tab={activeTab} />
            </div>
          )
        ) : (
          <div className="min-w-0 flex-1">
          <EmptyState icon={<Send />} title="No request open">
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <span>
                New request <Kbd>Ctrl N</Kbd>
              </span>
              <span>
                Command palette <Kbd>Ctrl K</Kbd>
              </span>
              <span>
                Send request <Kbd>Ctrl Enter</Kbd>
              </span>
            </div>
          </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
