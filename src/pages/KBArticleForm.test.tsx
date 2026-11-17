// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import KBArticleForm from './KBArticleForm';
import * as serviceWorker from '@/registerSW';

const mocks = vi.hoisted(() => ({
  data: undefined as undefined | {
    article: { id: string; title: string; content: string; category_id: string; article_type: string | null; tags: { id: string }[]; status: 'published' };
    crossRefs: { id: string; title: string }[];
  },
  api: { updateKbArticle: vi.fn(), createKbArticle: vi.fn(), linkKbArticleToTicket: vi.fn() },
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({ api: mocks.api }));
vi.mock('@/hooks/useKbArticle', () => ({
  useKbArticle: () => ({ data: mocks.data, isLoading: false, isError: false }),
  kbArticleKeys: { detail: (id: string) => ['kb-article', id] },
}));
vi.mock('@/hooks/useKbCategories', () => ({
  useKbCategories: () => ({ categories: [{ id: 'c1', name: 'Hårdvara' }], isError: false }),
  invalidateKbCaches: vi.fn(),
}));
vi.mock('@/hooks/useKbArticles', () => ({ useKbArticles: () => ({ articles: [] }), ticketKbLinksKeys: { ticket: (id: string) => ['ticket-kb', id] } }));
vi.mock('@/hooks/useTags', () => ({ useTags: () => ({ tags: [{ id: 'tag1', name: 'Skrivare', color: '#123456' }], error: null }) }));
vi.mock('@/lib/ticketImages', () => ({ kbImageAdapter: {} }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Artikelinnehåll" value={value} onChange={event => onChange(event.target.value)} />
  ),
}));
vi.mock('@/components/TagMultiSelect', () => ({
  TagMultiSelect: ({ selectedTagIds, onChange }: { selectedTagIds: string[]; onChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onChange(selectedTagIds.length ? [] : ['tag1'])}>Växla testtagg</button>
  ),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

function savedArticle() {
  return {
    article: { id: 'a1', title: 'Skrivare', content: '<p>Sparat innehåll</p>', category_id: 'c1', article_type: null, tags: [], status: 'published' as const },
    crossRefs: [],
  };
}
function setup(path = '/kb/a1/edit') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/kb/new" element={<KBArticleForm />} />
          <Route path="/kb/:id/edit" element={<KBArticleForm />} />
          <Route path="/kb/:id" element={<p>Artikel sparad eller lämnad</p>} />
          <Route path="/kb" element={<p>Kunskapsbasen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, refresh: () => result.rerender(view()) };
}
function unloadIsPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = savedArticle();
  mocks.api.updateKbArticle.mockResolvedValue({});
  mocks.api.createKbArticle.mockResolvedValue({ id: 'created' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); expect(serviceWorker.hasUnsavedWork()).toBe(false); });

describe('KB article unsaved-work protection', () => {
  it('keeps the loaded article clean, then protects edits continuously until they are reverted', () => {
    const register = vi.spyOn(serviceWorker, 'registerUnsavedWork');
    setup();
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Skrivare');
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    expect(unloadIsPrevented()).toBe(false);
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Ny titel' } });
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    expect(unloadIsPrevented()).toBe(true);
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Ny titel igen' } });
    expect(register).toHaveBeenCalledTimes(1);
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Skrivare' } });
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    expect(unloadIsPrevented()).toBe(false);
  });

  it('protects body-only and metadata-only edits and releases on unmount', () => {
    const view = setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Artikelinnehåll' }), { target: { value: '<p>Ändrad text</p>' } });
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Artikelinnehåll' }), { target: { value: '<p>Sparat innehåll</p>' } });
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    fireEvent.click(screen.getByText('Artikelinställningar'));
    fireEvent.click(screen.getByRole('button', { name: 'Växla testtagg' }));
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    view.unmount();
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    expect(unloadIsPrevented()).toBe(false);
  });

  it('does not treat an empty editor document as unsaved but protects a ticket-prefilled draft', () => {
    mocks.data = undefined;
    const view = setup('/kb/new');
    fireEvent.change(screen.getByRole('textbox', { name: 'Artikelinnehåll' }), { target: { value: '<p></p>' } });
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    view.unmount();
    setup('/kb/new?title=Från%20ärende&category=c1');
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Från ärende');
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    expect(unloadIsPrevented()).toBe(true);
  });

  it('does not reset edited fields or their saved baseline after a cache update', () => {
    const view = setup();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Eget utkast' } });
    mocks.data = { ...savedArticle(), crossRefs: [{ id: 'a2', title: 'Annan artikel' }] };
    view.refresh();
    expect(screen.getByText('Annan artikel')).toBeInTheDocument();
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Eget utkast');
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
  });

  it('retains the editor and protection while saving and after a rejected save', async () => {
    let rejectSave!: (error: Error) => void;
    mocks.api.updateKbArticle.mockReturnValue(new Promise((_, reject) => { rejectSave = reject; }));
    setup();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Osparad titel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara ändringar' }));
    expect(mocks.api.updateKbArticle).toHaveBeenCalledWith('a1', expect.objectContaining({ title: 'Osparad titel' }));
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    expect(unloadIsPrevented()).toBe(true);
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Osparad titel');
    await act(async () => rejectSave(new Error('Tillfälligt sparfel')));
    expect(mocks.toast.error).toHaveBeenCalledWith('Tillfälligt sparfel');
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Osparad titel');
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    expect(unloadIsPrevented()).toBe(true);
    expect(screen.getByRole('button', { name: 'Spara ändringar' })).toBeEnabled();
  });

  it('releases protection only after a successful save', async () => {
    let resolveSave!: (value: object) => void;
    mocks.api.updateKbArticle.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
    setup();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Ny sparad titel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara ändringar' }));
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    await act(async () => resolveSave({}));
    await waitFor(() => expect(screen.getByText('Artikel sparad eller lämnad')).toBeInTheDocument());
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    expect(unloadIsPrevented()).toBe(false);
  });

  it.each(['success', 'failure'] as const)('keeps a created article protected until source-ticket linking settles (%s)', async outcome => {
    let settleLink!: () => void;
    mocks.api.linkKbArticleToTicket.mockReturnValue(new Promise<void>((resolve, reject) => {
      settleLink = () => outcome === 'success' ? resolve() : reject(new Error('Tillfälligt länkningsfel'));
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.data = undefined;
    setup('/kb/new?title=Från%20ärende&category=c1&ticket_id=t1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Artikelinnehåll' }), { target: { value: '<p>Artikel från ärendet</p>' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skapa artikel' })); });

    expect(mocks.api.linkKbArticleToTicket).toHaveBeenCalledWith('t1', 'created');
    expect(screen.getByLabelText(/Titel/)).toHaveValue('Från ärende');
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    expect(unloadIsPrevented()).toBe(true);

    await act(async () => settleLink());
    expect(await screen.findByText('Artikel sparad eller lämnad')).toBeInTheDocument();
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    expect(unloadIsPrevented()).toBe(false);
    expect(mocks.api.createKbArticle).toHaveBeenCalledTimes(1);
  });

  it('releases protection after explicit cancellation', async () => {
    setup();
    fireEvent.change(screen.getByLabelText(/Titel/), { target: { value: 'Kastas' } });
    expect(serviceWorker.hasUnsavedWork()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(await screen.findByText('Artikel sparad eller lämnad')).toBeInTheDocument();
    expect(serviceWorker.hasUnsavedWork()).toBe(false);
    expect(unloadIsPrevented()).toBe(false);
  });
});
