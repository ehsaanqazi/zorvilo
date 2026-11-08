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
    <div className="flex flex-col">
      {rows.map((v, i) => {
        const isGhost = i === variables.length;
        const isHidden = v.secret && !revealed.has(v.id);
        return (
          <div key={v.id} className="group flex items-center gap-1.5 border-b border-border/40 py-1">
            <Checkbox
              checked={isGhost ? false : v.enabled}
              disabled={isGhost}
              onCheckedChange={(checked) => update(i, { enabled: checked === true })}
              className="ml-1 shrink-0"
            />
            <Input
              value={v.key}
              placeholder="Variable name"
              onChange={(e) => update(i, { key: e.target.value })}
              className="h-7 flex-1 border-transparent font-mono text-xs focus-visible:border-input"
            />
            <Input
              type={isHidden ? 'password' : 'text'}
              value={v.value}
              placeholder="Value"
              onChange={(e) => update(i, { value: e.target.value })}
              className="h-7 flex-[1.4] border-transparent font-mono text-xs focus-visible:border-input"
            />
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
        );
      })}
    </div>
  );
}
