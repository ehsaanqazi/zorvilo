import { Paperclip, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { ApiRequest, BodyConfig, BodyType, FormDataFile, FormDataItem } from '@/types/models';
import { BODY_TYPES, formDataFiles } from '@/types/models';
import { fileToBase64, formatBytes } from '@/lib/utils';
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
    <div className="flex flex-col gap-1 p-2">
      {items.map((item, i) => {
        const files = item.kind === 'file' ? formDataFiles(item) : [];
        return (
          <div key={item.id} className="flex items-start gap-1.5 border-b border-border/40 py-1">
            <Checkbox
              checked={item.enabled}
              onCheckedChange={(checked) => patch(i, { enabled: checked === true })}
              className="ml-1 mt-1.5 shrink-0"
            />
            <Input
              value={item.key}
              placeholder="Key"
              onChange={(e) => patch(i, { key: e.target.value })}
              className="h-7 flex-1 font-mono text-xs"
            />
            {item.kind === 'text' ? (
              <Input
                value={item.value}
                placeholder="Value"
                onChange={(e) => patch(i, { value: e.target.value })}
                className="h-7 flex-[1.4] font-mono text-xs"
              />
            ) : (
              <div className="flex flex-[1.4] flex-wrap items-center gap-1">
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
            <Button
              variant="ghost"
              size="iconSm"
              className="mt-0.5"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              aria-label="Remove row"
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <div className="flex gap-2 pt-1">
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-xs text-muted-foreground">Type</span>
        <Select value={body.type} onValueChange={(type) => set({ type: type as BodyType })}>
          <SelectTrigger className="h-7 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BODY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {body.type === 'json' && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              try {
                const formatted = JSON.stringify(JSON.parse(body.content), null, 2);
                set({ content: formatted });
              } catch {
                toast('error', 'Invalid JSON', 'The request body could not be parsed as JSON.');
              }
            }}
          >
            <Sparkles /> Beautify
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {body.type === 'none' && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            This request has no body.
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
          <div className="overflow-y-auto p-2">
            <KeyValueEditor
              request={request}
              items={body.formUrlEncoded}
              onChange={(formUrlEncoded) => set({ formUrlEncoded })}
              showDescription={false}
            />
          </div>
        )}

        {body.type === 'multipart' && (
          <div className="overflow-y-auto">
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
