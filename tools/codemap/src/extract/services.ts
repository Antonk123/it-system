import { SourceFile, SyntaxKind } from 'ts-morph';
import { extractTables } from './routes.js';

export interface ServiceFileResult {
  libImports: string[];
  reads: string[];
  writes: string[];
  isScheduler: boolean; // filnamn slutar på Scheduler
}

export function parseServiceFile(sf: SourceFile): ServiceFileResult {
  const libImports: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (spec.startsWith('./') || spec.includes('/lib/')) libImports.push(spec);
  }
  const reads = new Set<string>();
  const writes = new Set<string>();
  const collect = (text: string) => {
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(text)) return;
    const t = extractTables(text);
    t.reads.forEach((r) => reads.add(r));
    t.writes.forEach((w) => writes.add(w));
  };
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) collect(lit.getLiteralText());
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) collect(lit.getLiteralText());
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression)) collect(lit.getText());

  const base = sf.getBaseNameWithoutExtension();
  return { libImports, reads: [...reads], writes: [...writes], isScheduler: /Scheduler$/.test(base) };
}
