// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TemplateEditorModal } from './TemplateEditorModal';

vi.mock('@/lib/api', () => ({ api: { getTemplateFields: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({
    createTemplateField: vi.fn(), updateTemplateField: vi.fn(), deleteTemplateField: vi.fn(), reorderTemplateFields: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/DynamicField', () => ({ DynamicField: () => null }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) =>
    <textarea value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />,
}));

afterEach(cleanup);

async function fillStandardTemplate(onSave: () => Promise<{ id: string } | null>, onOpenChange = vi.fn()) {
  render(
    <TemplateEditorModal open onOpenChange={onOpenChange} template={null} categories={[]} onSave={onSave} onUpdate={vi.fn()} />
  );
  fireEvent.click(await screen.findByRole('button', { name: /Standard mall/ }));
  fireEvent.change(await screen.findByLabelText(/Mallnamn/), { target: { value: 'Ny mall' } });
  fireEvent.change(screen.getByLabelText(/Titelmall/), { target: { value: 'Titel' } });
  fireEvent.change(screen.getByPlaceholderText('Detaljerad beskrivning av problemet...'), { target: { value: '<p>Text</p>' } });
  return onOpenChange;
}

describe('TemplateEditorModal — skapa', () => {
  it('inaktiverar knappen medan mallen sparas och stänger dialogen efteråt', async () => {
    let resolveSave: (value: { id: string }) => void = () => {};
    const onSave = vi.fn(() => new Promise<{ id: string } | null>(resolve => { resolveSave = resolve; }));
    const onOpenChange = await fillStandardTemplate(onSave);

    fireEvent.click(screen.getByRole('button', { name: 'Skapa mall' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Skapa mall' })).toBeDisabled());
    expect(onOpenChange).not.toHaveBeenCalled();
    resolveSave({ id: 't1' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('lämnar dialogen öppen och knappen aktiv för nytt försök när sparandet misslyckas', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const onOpenChange = await fillStandardTemplate(onSave);

    fireEvent.click(screen.getByRole('button', { name: 'Skapa mall' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skapa mall' })).toBeEnabled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Mallnamn/)).toHaveValue('Ny mall');
  });
});
