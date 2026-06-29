import { SourceFile, SyntaxKind } from 'ts-morph';

/** Alla api.<method>(-anrop i en hook-fil. */
export function parseHookApiCalls(sf: SourceFile): string[] {
  const names = new Set<string>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.isKind(SyntaxKind.PropertyAccessExpression) && expr.getExpression().getText() === 'api') {
      names.add(expr.getName());
    }
  }
  return [...names];
}

/** Importerade hook-namn (use*) i en sida. */
export function parsePageHookImports(sf: SourceFile): string[] {
  const hooks = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    if (!imp.getModuleSpecifierValue().includes('/hooks/')) continue;
    for (const named of imp.getNamedImports()) {
      const name = named.getName();
      if (name.startsWith('use')) hooks.add(name);
    }
    const def = imp.getDefaultImport();
    if (def && def.getText().startsWith('use')) hooks.add(def.getText());
  }
  return [...hooks];
}
