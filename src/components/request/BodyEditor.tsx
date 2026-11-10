import { Paperclip, Trash2, Upload, X } from 'lucide-react';
import type { ApiRequest, BodyConfig, BodyType, FormDataFile, FormDataItem } from '@/types/models';
import { BODY_TYPES, formDataFiles } from '@/types/models';
import { cn, fileToBase64, formatBytes } from '@/lib/utils';
import { newKeyValue } from '@/lib/factories';
import { toast } from '@/store/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KeyValueEditor } from './KeyValueEditor';
import { LazyCodeEditor } from '@/components/editor/LazyCodeEditor';
import { useVariableLookup, useVariableSuggestions } from '@/features/variables/lookup';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const LABELS: Record<BodyType, string> = {
  none: 'None',
  json: 'JSON',
  raw: 'Raw',
  xml: 'XML',
  html: 'HTML',
  text: 'Text',
  graphql: 'GraphQL',
  'form-urlencoded': 'x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  binary: 'Binary',
};

/** Body types that Postman groups under the single "raw" radio. */
const RAW_TYPES: BodyType[] = ['text', 'json', 'xml', 'html', 'raw'];

/** Postman's body mode radios, mapped onto the existing body types. */
const BODY_MODES: { key: string; label: string; type: BodyType }[] = [
  { key: 'none', label: 'none', type: 'none' },
  { key: 'multipart', label: 'form-data', type: 'multipart' },
  { key: 'form-urlencoded', label: 'x-www-form-urlencoded', type: 'form-urlencoded' },
  { key: 'raw', label: 'raw', type: 'json' },
  { key: 'binary', label: 'binary', type: 'binary' },
  { key: 'graphql', label: 'GraphQL', type: 'graphql' },
];

const MONACO_LANG: Partial<Record<BodyType, string>> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  text: 'plaintext',
  raw: 'plaintext',
};

async function pickFile(): Promise<{ file: File; base64: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > MAX_FILE_BYTES) {
        toast('error', 'File too large', `Files are capped at ${formatBytes(MAX_FILE_BYTES)} for local storage.`);
        return resolve(null);
      }
      resolve({ file, base64: await fileToBase64(file) });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Open the picker allowing multiple files and return the accepted ones as FormDataFile[]. */
async function pickFiles(): Promise<FormDataFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return resolve([]);
      const accepted: FormDataFile[] = [];
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          toast('error', 'File too large', `${file.name} exceeds the ${formatBytes(MAX_FILE_BYTES)} limit and was skipped.`);
          continue;
        }
        accepted.push({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          fileBase64: await fileToBase64(file),
        });
      }
      resolve(accepted);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function MultipartEditor({
  items,
  onChange,
}: {
  items: FormDataItem[];
  onChange: (items: FormDataItem[]) => void;
}) {
  const patch = (i: number, next: Partial<FormDataItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...next } : it)));

  const addText = () => onChange([...items, { ...newKeyValue(), kind: 'text' }]);
  const addFile = () => onChange([...items, { ...newKeyValue({ key: 'file' }), kind: 'file', files: [] }]);

  // Attach files to a row: normalize any legacy single-file fields first, then append the picked files.
  const attachFiles = async (i: number) => {
    const item = items[i];
    if (!item) return;
    const picked = await pickFiles();
    if (!picked.length) return;
    const existing = formDataFiles(item);
    patch(i, { files: [...existing, ...picked], fileName: undefined, contentType: undefined, fileBase64: undefined });
  };

  const removeFile = (i: number, fileIdx: number) => {
    const item = items[i];
    if (!item) return;
    const files = formDataFiles(item).filter((_, idx) => idx !== fileIdx);
    patch(i, { files, fileName: undefined, contentType: undefined, fileBase64: undefined });
  };

  return (
    <div className="flex flex-col px-4 pb-4 pt-1">
      <div className="flex flex-col border text-xs">
      <div className="flex h-8 items-stretch border-b font-semibold text-muted-foreground">
        <span className="w-8 shrink-0 border-r" />
        <span className="flex min-w-0 flex-1 items-center border-r px-2.5">Key</span>
        <span className="flex min-w-0 flex-[1.4] items-center px-2.5">Value</span>
        <span className="w-8 shrink-0" />
      </div>
      {items.map((item, i) => {
        const files = item.kind === 'file' ? formDataFiles(item) : [];
        return (
          <div
            key={item.id}
            className="group flex min-h-8 items-stretch border-b last:border-b-0 hover:bg-muted/60"
          >
            <div className="flex w-8 shrink-0 items-center justify-center border-r">
              <Checkbox
                checked={item.enabled}
                onCheckedChange={(checked) => patch(i, { enabled: checked === true })}
                className="shrink-0"
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center border-r px-0.5">
              <Input
                value={item.key}
                placeholder="Key"
                onChange={(e) => patch(i, { key: e.target.value })}
                className="h-7 flex-1 border-transparent px-2 font-mono text-xs focus-visible:border-input focus-visible:ring-0"
              />
              <span className="shrink-0 rounded-sm bg-secondary px-1 py-px text-[10px] text-muted-foreground">
                {item.kind === 'file' ? 'File' : 'Text'}
              </span>
              <span className="w-1 shrink-0" />
            </div>
            {item.kind === 'text' ? (
              <div className="flex min-w-0 flex-[1.4] items-center px-0.5">
                <Input
                  value={item.value}
                  placeholder="Value"
                  onChange={(e) => patch(i, { value: e.target.value })}
                  className="h-7 flex-1 border-transparent px-2 font-mono text-xs focus-visible:border-input focus-visible:ring-0"
                />
              </div>
            ) : (
              <div className="flex min-w-0 flex-[1.4] flex-wrap items-center gap-1 px-2 py-1">
                {files.map((f, fileIdx) => (
                  <span
                    key={fileIdx}
                    className="flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
                    title={f.contentType ? `${f.fileName} (${f.contentType})` : f.fileName}
                  >
                    <span className="truncate">{f.fileName}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i, fileIdx)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${f.fileName}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => void attachFiles(i)}
                  title="Attach file(s)"
                  aria-label="Attach files"
                >
                  <Paperclip />
                </Button>
                {files.length === 0 && (
                  <span className="text-xs text-muted-foreground">Select file(s)</span>
                )}
              </div>
            )}
            <div className="flex w-8 shrink-0 items-center justify-center">
              <Button
                variant="ghost"
                size="iconSm"
                className="invisible group-hover:visible"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                aria-label="Remove row"
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
      {items.length === 0 && (
        <div className="flex h-8 items-center px-2.5 text-muted-foreground">No fields yet</div>
      )}
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={addText}>
          Add text field
        </Button>
        <Button variant="outline" size="sm" onClick={addFile}>
          <Upload /> Add file
        </Button>
      </div>
    </div>
  );
}

export function BodyEditor({
  request,
  onChange,
}: {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
}) {
  const body = request.body;
  const set = (patch: Partial<BodyConfig>) => onChange({ body: { ...body, ...patch } });
  const variableLookup = useVariableLookup(request);
  const variableSuggestions = useVariableSuggestions(request);
  const isRaw = RAW_TYPES.includes(body.type);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        {BODY_MODES.filter((m) => BODY_TYPES.includes(m.type)).map((m) => {
          const selected = m.key === 'raw' ? isRaw : body.type === m.type;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (!selected) set({ type: m.type });
              }}
              className={cn(
                'flex items-center gap-1.5 text-xs',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-primary' : 'border-muted-foreground/60',
                )}
              >
                {selected && <span className="size-2 rounded-full bg-primary" />}
              </span>
              {m.label}
            </button>
          );
        })}
        {isRaw && (
          <Select value={body.type} onValueChange={(type) => set({ type: type as BodyType })}>
            <SelectTrigger className="h-6 gap-1 border-0 px-1 font-medium text-send focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RAW_TYPES.filter((t) => BODY_TYPES.includes(t)).map((t) => (
                <SelectItem key={t} value={t}>
                  {LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {body.type === 'json' && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-1.5 font-medium text-send hover:text-send"
            onClick={() => {
              try {
                const formatted = JSON.stringify(JSON.parse(body.content), null, 2);
                set({ content: formatted });
              } catch {
                toast('error', 'Invalid JSON', 'The request body could not be parsed as JSON.');
              }
            }}
          >
            Beautify
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {body.type === 'none' && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            This request does not have a body
          </div>
        )}

        {(body.type === 'json' ||
          body.type === 'raw' ||
          body.type === 'xml' ||
          body.type === 'html' ||
          body.type === 'text') && (
          <LazyCodeEditor
            value={body.content}
            language={MONACO_LANG[body.type] ?? 'plaintext'}
            onChange={(content) => set({ content })}
            variableLookup={variableLookup}
            variableSuggestions={variableSuggestions}
          />
        )}

        {body.type === 'graphql' && (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-[2] border-b">
              <LazyCodeEditor
                value={body.graphql.query}
                language="graphql"
                onChange={(query) => set({ graphql: { ...body.graphql, query } })}
                variableLookup={variableLookup}
                variableSuggestions={variableSuggestions}
              />
            </div>
            <div className="border-b px-3 py-1 text-[11px] text-muted-foreground">Variables (JSON)</div>
            <div className="min-h-0 flex-1">
              <LazyCodeEditor
                value={body.graphql.variables}
                language="json"
                onChange={(variables) => set({ graphql: { ...body.graphql, variables } })}
                variableLookup={variableLookup}
                variableSuggestions={variableSuggestions}
              />
            </div>
          </div>
        )}

        {body.type === 'form-urlencoded' && (
          <div className="h-full overflow-y-auto px-4 pb-4 pt-1">
            <KeyValueEditor
              request={request}
              items={body.formUrlEncoded}
              onChange={(formUrlEncoded) => set({ formUrlEncoded })}
              showDescription={false}
            />
          </div>
        )}

        {body.type === 'multipart' && (
          <div className="h-full overflow-y-auto">
            <MultipartEditor items={body.multipart} onChange={(multipart) => set({ multipart })} />
          </div>
        )}

        {body.type === 'binary' && (
          <div className="flex flex-col items-start gap-2 p-4">
            {body.binary ? (
              <div className="flex items-center gap-2 text-sm">
                <span>📎 {body.binary.fileName}</span>
                <span className="text-xs text-muted-foreground">{body.binary.contentType}</span>
                <Button variant="ghost" size="iconSm" onClick={() => set({ binary: null })}>
                  <Trash2 />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No file selected.</p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const picked = await pickFile();
                if (!picked) return;
                set({
                  binary: {
                    fileName: picked.file.name,
                    contentType: picked.file.type || 'application/octet-stream',
                    base64: picked.base64,
                  },
                });
              }}
            >
              <Upload /> Choose file
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
