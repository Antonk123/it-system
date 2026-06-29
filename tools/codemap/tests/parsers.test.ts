import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { parseRouteRegistrations, parseRouteFile } from '../src/extract/routes.js';
import { parseApiClient } from '../src/extract/apiClient.js';
import { parseHookApiCalls, parsePageHookImports } from '../src/extract/frontend.js';
import { parseServiceFile } from '../src/extract/services.js';

function file(name: string, content: string) {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile(name, content);
}

describe('parseRouteRegistrations', () => {
  it('drar ut prefix → router-ident', () => {
    const sf = file('app.ts', `
      import companiesRoutes from './routes/companies.js';
      const app = express();
      app.use('/api/companies', companiesRoutes);
      app.use('/api/billing', billingRoutes);
    `);
    const regs = parseRouteRegistrations(sf);
    expect(regs).toContainEqual({ prefix: '/api/companies', routerIdent: 'companiesRoutes' });
    expect(regs).toHaveLength(2);
  });
});

describe('parseRouteFile', () => {
  it('endpoints, service-imports och SQL-tabeller', () => {
    const sf = file('companies.ts', `
      import { db } from '../db/connection.js';
      import { applySLAToTicket } from '../lib/slaHelper.js';
      const router = Router();
      router.get('/', (req, res) => { db.prepare('SELECT * FROM companies').all(); });
      router.post('/:id/sla', (req, res) => { applySLAToTicket(req.params.id); db.prepare('UPDATE companies SET sla_disabled = 1 WHERE id = ?').run(); });
      export default router;
    `);
    const r = parseRouteFile(sf, '/api/companies');
    expect(r.endpoints).toEqual([{ method: 'GET', path: '/' }, { method: 'POST', path: '/:id/sla' }]);
    expect(r.serviceImports).toContain('../lib/slaHelper.js');
    expect(r.reads).toContain('companies');
    expect(r.writes).toContain('companies');
  });
});

describe('parseApiClient', () => {
  it('mappar metod -> prefix och fångar radnummer', () => {
    const sf = file('api.ts', `
      class ApiClient {
        private request(path: string) { return fetch(path); }
        getCompanies() { return this.request('/companies'); }
        getInvoice(id: string) { return this.request(\`/billing/invoices/\${id}\`); }
      }
      export const api = new ApiClient();
    `);
    const methods = parseApiClient(sf);
    const byName = Object.fromEntries(methods.map((m) => [m.name, m.prefix]));
    expect(byName['getCompanies']).toBe('/api/companies');
    expect(byName['getInvoice']).toBe('/api/billing');
    expect(methods.find((m) => m.name === 'getCompanies')!.line).toBeGreaterThan(0);
  });
});

describe('frontend', () => {
  it('hook->api och page->hook', () => {
    const hook = file('useCompanies.ts', `import { api } from '@/lib/api'; export const useCompanies = () => api.getCompanies();`);
    expect(parseHookApiCalls(hook)).toEqual(['getCompanies']);
    const page = file('CompanyList.tsx', `import { useCompanies } from '@/hooks/useCompanies'; import { Button } from '@/components/ui/button'; export default function P(){ useCompanies(); return null; }`);
    expect(parsePageHookImports(page)).toEqual(['useCompanies']);
  });
});

describe('parseServiceFile', () => {
  it('lib-imports, tabeller, scheduler-flagga', () => {
    const sf = file('slaHelper.ts', `
      import { db } from '../db/connection.js';
      import { logger } from './logger.js';
      export function f(){ db.prepare('SELECT * FROM sla_policies').get(); db.prepare('UPDATE tickets SET x=1').run(); }
    `);
    const r = parseServiceFile(sf);
    expect(r.libImports).toContain('./logger.js');
    expect(r.reads).toContain('sla_policies');
    expect(r.writes).toContain('tickets');
    expect(r.isScheduler).toBe(false);
    expect(parseServiceFile(file('slaScheduler.ts', 'export const x=1;')).isScheduler).toBe(true);
  });
});
