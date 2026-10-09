// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTemplates, templateKeys } from './useTemplates';

const field = (id: string) => ({
  id, template_id: 't1', field_name: id, field_label: id, field_type: 'text', placeholder: null,
  default_value: null, required: 0, options: null, position: 0, created_at: '2026-09-08T10:00:00Z', updated_at: '2026-09-08T10:00:00Z',
});
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, description: null, template_type: 'dynamic', title_template: 'Titel', description_template: '',
  priority: 'medium', category_id: null, notes_template: null, solution_template: null, position: 0, created_by: null,
  created_at: '2026-09-08T10:00:00Z', updated_at: '2026-09-08T10:00:00Z', ...extra,
});

const api = vi.hoisted(() => ({
  getTemplates: vi.fn(),
  reorderTemplates: vi.fn(),
  createTemplate: vi.fn(),
  createTemplateField: vi.fn(),
  updateTemplateField: vi.fn(),
  deleteTemplateField: vi.fn(),
  reorderTemplateFields: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useTemplates(), { wrapper }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTemplates.mockResolvedValue([row('t1', { fields: [field('f1')] }), row('t2', { template_type: 'standard', description_template: '<p>x</p>' })]);
});
afterEach(cleanup);

describe('useTemplates', () => {
  it('behåller typ och fält när mallarna omordnas', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.templates).toHaveLength(2));
    api.reorderTemplates.mockResolvedValue([row('t2', { template_type: 'standard', position: 0 }), row('t1', { position: 1 })]);

    await act(async () => { await result.current.reorderTemplates(["t2", "t1"]); });

    await waitFor(() => expect(result.current.templates[0].id).toBe('t2'));
    const [first, second] = result.current.templates;
    expect(first).toMatchObject({ id: 't2', type: 'standard' });
    expect(second).toMatchObject({ id: 't1', type: 'dynamic' });
    expect(second.fields).toHaveLength(1);
  });

  it('sväljer fel vid omordning så att anrop utan await inte ger unhandled rejection', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.templates).toHaveLength(2));
    api.reorderTemplates.mockRejectedValue(new Error('nej'));
    await expect(result.current.reorderTemplates(['t2', 't1'])).resolves.toBeUndefined();
  });

  it('skickar fälten i samma anrop när en mall skapas', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.templates).toHaveLength(2));
    api.createTemplate.mockResolvedValue(row('t3', { fields: [field('f9')] }));

    let created;
    await act(async () => {
      created = await result.current.addTemplate({
        name: 'Ny', description: null, type: 'dynamic', titleTemplate: 'Titel', descriptionTemplate: null,
        priority: 'medium', category: null, notesTemplate: null, solutionTemplate: null,
        fields: [{ ...field('temp-1'), options: '["a","b"]' }],
      });
    });

    expect(created).toMatchObject({ id: 't3' });
    expect(api.createTemplate).toHaveBeenCalledWith(expect.objectContaining({
      fields: [expect.objectContaining({ field_name: 'temp-1', options: ['a', 'b'] })],
    }));
  });

  it('invaliderar mall-listan efter fältoperationer', async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.templates).toHaveLength(2));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    api.createTemplateField.mockResolvedValue(field('f2'));
    api.updateTemplateField.mockResolvedValue(field('f2'));
    api.deleteTemplateField.mockResolvedValue(undefined);
    api.reorderTemplateFields.mockResolvedValue([]);

    await act(async () => {
      await result.current.createTemplateField('t1', { field_name: 'a', field_label: 'A', field_type: 'text' });
      await result.current.updateTemplateField('t1', 'f2', { field_label: 'B' });
      await result.current.deleteTemplateField('t1', 'f2');
      await result.current.reorderTemplateFields('t1', ['f1']);
    });

    const calls = invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(templateKeys.list()));
    expect(calls).toHaveLength(4);
  });

  it('returnerar null/false (och toastar) när en fältoperation misslyckas', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.templates).toHaveLength(2));
    api.createTemplateField.mockRejectedValue(new Error('fel'));
    api.deleteTemplateField.mockRejectedValue(new Error('fel'));

    await act(async () => {
      expect(await result.current.createTemplateField('t1', { field_name: 'a', field_label: 'A', field_type: 'text' })).toBeNull();
      expect(await result.current.deleteTemplateField('t1', 'f1')).toBe(false);
    });
  });
});
