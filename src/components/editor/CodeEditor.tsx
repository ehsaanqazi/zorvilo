import * as React from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import { useThemeState } from '@/hooks/useTheme';
import { useSettings } from '@/store/settings';
import { askText, useUi } from '@/store/ui';
import {
  quickAddVariable,
  type VariableInfo,
  type VariableSuggestion,
} from '@/features/variables/lookup';

/**
 * Monaco is bundled locally (no CDN) so the editor works fully offline.
 * This module is heavy — always import it through LazyCodeEditor.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

// Allow JSONC in body editors: comments and trailing commas are tolerated
// (they're stripped before the request is sent), so Monaco shouldn't flag them.
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  trailingCommas: 'ignore',
  schemaValidation: 'warning',
});

const VAR_RE = /\{\{\s*(\$?[\w.-]+)\s*\}\}/g;

/** model id → variable lookup for the hover provider (set by mounted editors) */
const modelLookups = new Map<string, (name: string) => VariableInfo>();
/** model id → suggestion list for {{ autocomplete */
const modelSuggestions = new Map<string, () => VariableSuggestion[]>();
let hoverInstalled = false;

function installVariableHover() {
  if (hoverInstalled) return;
  hoverInstalled = true;

  monaco.languages.registerHoverProvider('*', {
    provideHover(model, position) {
      const lookup = modelLookups.get(model.id);
      if (!lookup) return null;
      const line = model.getLineContent(position.lineNumber);
      VAR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_RE.exec(line)) !== null) {
        const startCol = m.index + 1;
        const endCol = startCol + m[0].length;
        if (position.column < startCol || position.column > endCol) continue;
        const name = m[1]!;
        const info = lookup(name);
        const contents: monaco.IMarkdownString[] = info.found
          ? [
              { value: `**\`{{${name}}}\`** — ${info.scopeLabel}` },
              { value: '```\n' + (info.secret ? '••••••••' : info.value || '(empty)') + '\n```' },
            ]
          : [
              { value: `**\`{{${name}}}\`** is not defined in the current scope.` },
              {
                value: `[Set value…](command:yl.setVariable?${encodeURIComponent(
                  JSON.stringify(name),
                )} "Add this variable to the active environment")`,
                isTrusted: true,
              },
            ];
        return {
          range: new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol),
          contents,
        };
      }
      return null;
    },
  });

  monaco.editor.registerCommand('yl.setVariable', (_accessor, name: string) => {
    void askText(`Value for {{${name}}}`, 'value').then((value) => {
      if (value !== null) quickAddVariable(name, value);
    });
  });

  // {{ autocomplete listing every variable in scope (incl. dynamic $ vars)
  monaco.languages.registerCompletionItemProvider('*', {
    triggerCharacters: ['{'],
    provideCompletionItems(model, position) {
      const getList = modelSuggestions.get(model.id);
      if (!getList) return { suggestions: [] };
      const prefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const m = prefix.match(/\{\{(\$?[\w.-]*)$/);
      if (!m) return { suggestions: [] };
      const startColumn = position.column - m[0].length;
      const range = new monaco.Range(
        position.lineNumber,
        startColumn,
        position.lineNumber,
        position.column,
      );
      const line = model.getLineContent(position.lineNumber);
      const alreadyClosed = line.slice(position.column - 1).startsWith('}}');
      return {
        suggestions: getList().map((s, i) => ({
          label: `{{${s.name}}}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: `${s.scopeLabel} · ${s.secret ? '••••••••' : s.value}`,
          insertText: alreadyClosed ? `{{${s.name}` : `{{${s.name}}}`,
          range,
          sortText: String(i).padStart(4, '0'),
        })),
      };
    },
  });
}

export interface CodeDiffProps {
  original: string;
  modified: string;
  language: string;
  className?: string;
}

/** Side-by-side read-only diff (saved response vs current response). */
export function CodeDiffEditor({ original, modified, language, className }: CodeDiffProps) {
  const isDark = useThemeState((s) => s.isDark);
  const editorFontSize = useSettings((s) => s.settings.editorFontSize);
  return (
    <div className={className} style={{ height: '100%', minHeight: 0 }}>
      <DiffEditor
        original={original}
        modified={modified}
        language={language}
        theme={isDark ? 'vs-dark' : 'vs'}
        options={{
          readOnly: true,
          renderSideBySide: true,
          fontSize: editorFontSize,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          overviewRulerLanes: 0,
          lineNumbersMinChars: 3,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}

export interface CodeEditorProps {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  /** enables {{variable}} highlighting + hover cards (body editors) */
  variableLookup?: (name: string) => VariableInfo;
  /** enables {{ autocomplete (body editors) */
  variableSuggestions?: () => VariableSuggestion[];
}

export default function CodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
  className,
  variableLookup,
  variableSuggestions,
}: CodeEditorProps) {
  const isDark = useThemeState((s) => s.isDark);
  const editorFontSize = useSettings((s) => s.settings.editorFontSize);
  const wordWrap = useSettings((s) => s.settings.wordWrap);

  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = React.useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const lookupRef = React.useRef(variableLookup);
  lookupRef.current = variableLookup;
  const suggestionsRef = React.useRef(variableSuggestions);
  suggestionsRef.current = variableSuggestions;
  const [mounted, setMounted] = React.useState(false);

  const applyDecorations = React.useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const lookup = lookupRef.current;
    if (!lookup) {
      decorationsRef.current?.clear();
      return;
    }
    const text = model.getValue();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    if (text.length <= 500_000 && text.includes('{{')) {
      VAR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_RE.exec(text)) !== null && decorations.length < 2000) {
        const start = model.getPositionAt(m.index);
        const end = model.getPositionAt(m.index + m[0].length);
        decorations.push({
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: {
            inlineClassName: lookup(m[1]!).found ? 'yl-var-ok' : 'yl-var-missing',
          },
        });
      }
    }
    decorationsRef.current ??= editor.createDecorationsCollection();
    decorationsRef.current.set(decorations);
  }, []);

  // register this editor's model for hover/completion + keep decorations current
  React.useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!mounted || !model || !variableLookup) return;
    installVariableHover();
    modelLookups.set(model.id, (name) => lookupRef.current!(name));
    if (variableSuggestions) {
      modelSuggestions.set(model.id, () => suggestionsRef.current?.() ?? []);
    }
    applyDecorations();
    return () => {
      modelLookups.delete(model.id);
      modelSuggestions.delete(model.id);
    };
  }, [mounted, variableLookup, variableSuggestions, applyDecorations]);

  React.useEffect(() => {
    if (mounted) applyDecorations();
  }, [value, mounted, applyDecorations]);

  return (
    <div className={className} style={{ height: '100%', minHeight: 0 }}>
      <Editor
        value={value}
        language={language}
        theme={isDark ? 'vs-dark' : 'vs'}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={(editor) => {
          editorRef.current = editor;
          // Monaco swallows global shortcuts — re-bind "send request" here
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            const tabId = useUi.getState().ui.activeTabId;
            if (tabId) void import('@/features/http/execute').then((m) => m.executeTab(tabId));
          });
          setMounted(true);
        }}
        options={{
          readOnly,
          fontSize: editorFontSize,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: wordWrap ? 'on' : 'off',
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          folding: true,
          lineNumbersMinChars: 3,
          padding: { top: 8 },
          automaticLayout: true,
          fixedOverflowWidgets: true,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          // keep huge responses from freezing the tab
          largeFileOptimizations: true,
          occurrencesHighlight: 'off',
        }}
      />
    </div>
  );
}
