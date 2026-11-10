import * as React from 'react';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { Variable } from '@/types/models';
import { newVariable } from '@/lib/factories';
import { Checkbox } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** Variable grid: enable/disable, secret masking, auto-appending empty row. */
export function VariablesEditor({
  variables,
  onChange,
}: {
  variables: Variable[];
  onChange: (variables: Variable[]) => void;
}) {
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  const rows = [...variables, newVariable()];

  const update = (index: number, patch: Partial<Variable>) => {
    if (index === variables.length) {
      onChange([...variables, { ...rows[index]!, ...patch }]);
    } else {
      onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)));
    }
  };

  return (
    <div className="flex flex-col border text-xs">
      <div className="flex h-8 items-stretch border-b font-semibold text-muted-foreground">
        <span className="w-8 shrink-0 border-r" />
        <span className="flex min-w-0 flex-1 items-center border-r px-2.5">Variable</span>
        <span className="flex min-w-0 flex-[1.4] items-center px-2.5">Value</span>
        <span className="w-14 shrink-0" />
      </div>
      {rows.map((v, i) => {
        const isGhost = i === variables.length;
        const isHidden = v.secret && !revealed.has(v.id);
        return (
          <div
            key={v.id}
            className="group flex min-h-8 items-stretch border-b last:border-b-0 hover:bg-muted/60"
          >
            <div className="flex w-8 shrink-0 items-center justify-center border-r">
              {!isGhost && (
                <Checkbox
                  checked={v.enabled}
                  onCheckedChange={(checked) => update(i, { enabled: checked === true })}
                  className="shrink-0"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 items-center border-r px-0.5">
              <Input
                value={v.key}
                placeholder="Variable name"
                onChange={(e) => update(i, { key: e.target.value })}
                className="h-7 flex-1 border-transparent px-2 font-mono text-xs focus-visible:border-input focus-visible:ring-0"
              />
            </div>
            <div className="flex min-w-0 flex-[1.4] items-center px-0.5">
              <Input
                type={isHidden ? 'password' : 'text'}
                value={v.value}
                placeholder="Value"
                onChange={(e) => update(i, { value: e.target.value })}
                className="h-7 flex-1 border-transparent px-2 font-mono text-xs focus-visible:border-input focus-visible:ring-0"
              />
            </div>
            <div className="flex w-14 shrink-0 items-center justify-center">
            <Button
              variant="ghost"
              size="iconSm"
              title={v.secret ? 'Secret (click eye to reveal)' : 'Mark as secret'}
              className={isGhost ? 'invisible' : v.secret ? 'text-primary' : 'opacity-40'}
              onClick={() => {
                if (!v.secret) {
                  update(i, { secret: true });
                } else {
                  setRevealed((prev) => {
                    const next = new Set(prev);
                    if (next.has(v.id)) next.delete(v.id);
                    else next.add(v.id);
                    return next;
                  });
                }
              }}
            >
              {isHidden ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              className={isGhost ? 'invisible' : 'invisible group-hover:visible'}
              onClick={() => onChange(variables.filter((_, idx) => idx !== i))}
            >
              <Trash2 />
            </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
