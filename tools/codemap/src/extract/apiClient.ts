import { SourceFile, SyntaxKind } from 'ts-morph';

export interface ApiMethod {
  name: string; // t.ex. getCompanies
  prefix: string; // t.ex. /api/companies (första segmentet efter /api)
  line: number; // radnummer i api.ts
}

/** Härleder route-prefix ur ett URL-fragment: '/companies' -> '/api/companies'. */
export function prefixFromFragment(fragment: string): string | null {
  const clean = fragment.replace(/^\/+/, '').split(/[/?`$]/)[0];
  if (!clean) return null;
  return `/api/${clean}`;
}

/** Drar ut publika metoder i ApiClient-klassen + det route-prefix de träffar. */
export function parseApiClient(sf: SourceFile): ApiMethod[] {
  const out: ApiMethod[] = [];
  const cls = sf.getClasses().find((c) => c.getMethods().length > 0);
  if (!cls) return out;

  for (const method of cls.getMethods()) {
    const name = method.getName();
    if (name === 'request' || name.startsWith('#') || method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
    let prefix: string | null = null;
    for (const lit of method.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      if (lit.getLiteralText().startsWith('/')) {
        prefix = prefixFromFragment(lit.getLiteralText());
        break;
      }
    }
    if (!prefix) {
      for (const tmpl of method.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
        const head = tmpl.getHead().getLiteralText(); // t.ex. "/billing/invoices/"
        if (head.startsWith('/')) {
          prefix = prefixFromFragment(head);
          break;
        }
      }
    }
    if (prefix) out.push({ name, prefix, line: method.getStartLineNumber() });
  }
  return out;
}
