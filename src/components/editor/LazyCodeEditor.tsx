import { lazy, Suspense } from 'react';
import type { CodeDiffProps, CodeEditorProps } from './CodeEditor';

const CodeEditor = lazy(() => import('./CodeEditor'));
const CodeDiff = lazy(() =>
  import('./CodeEditor').then((m) => ({ default: m.CodeDiffEditor })),
);

function Fallback() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      Loading editor…
    </div>
  );
}

/** Lazy Monaco: keeps first paint instant; the editor chunk loads on demand. */
export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<Fallback />}>
      <CodeEditor {...props} />
    </Suspense>
  );
}

export function LazyDiffEditor(props: CodeDiffProps) {
  return (
    <Suspense fallback={<Fallback />}>
      <CodeDiff {...props} />
    </Suspense>
  );
}
