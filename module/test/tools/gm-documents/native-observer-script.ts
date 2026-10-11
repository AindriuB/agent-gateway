import { readFileSync } from 'node:fs';
import ts from 'typescript';
export interface NativeObserverTarget {
  journalUuid: string;
  pageId: string;
  gmId: string;
  roots: string[];
}
/** Compile the reviewed standalone TS source without tsx/esbuild's injected __name closure. */
export function nativeObserverScript(target: NativeObserverTarget): string {
  const source = readFileSync(new URL('./native-audit-progress.ts', import.meta.url), 'utf8');
  const standalone = source.replace(
    /^export function observeNativeAuditProgress/m,
    'function observeNativeAuditProgress',
  );
  if (standalone === source) throw Error('Standalone observer export not found');
  const js = ts.transpileModule(standalone, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      removeComments: true,
    },
  }).outputText;
  return `(() => { ${js}; return observeNativeAuditProgress(${JSON.stringify(target)}); })()`;
}
