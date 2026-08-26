// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import PublicKnowledgeBase from './PublicKnowledgeBase';
import PublicKBArticle from './PublicKBArticle';

const api = vi.hoisted(() => ({
  getKbPortalCategories: vi.fn(),
  getKbPortalArticles: vi.fn(),
  getKbPortalArticle: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/components/KBImageLightbox', () => ({ KBImageLightbox: () => null }));

const categories = [
  { id: 'network', name: 'Nätverk', color: '#0ea5e9', article_count: 2 },
  { id: 'empty', name: 'Tom kategori', color: null, article_count: 0 },
];
const summary = {
  id: 'wifi-guide', title: 'Anslut till Wi-Fi', snippet: '<p>Så ansluter du säkert.</p>',
  category_id: 'network', category_name: 'Nätverk', category_color: '#0ea5e9', article_type: 'how-to',
  tags: [{ id: 'wifi', name: 'Wi-Fi', color: '#0ea5e9' }], updated_at: '2026-08-26T12:00:00Z',
};
const article = { ...summary, content: '<p>Steg ett: välj nätverket.</p>' };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
function HistoryBackProbe() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Historik bakåt</button>;
}
function renderPortal(path = '/kb/public/token-1') {
  return render(<MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/kb/public/:token" element={<PublicKnowledgeBase />} /></Routes></MemoryRouter>);
}
function renderArticle(path = '/kb/public/token-1/article/wifi-guide', state?: unknown) {
  return render(<MemoryRouter initialEntries={[{ pathname: path, state }]}><LocationProbe /><Routes><Route path="/kb/public/:token/article/:articleId" element={<PublicKBArticle />} /></Routes></MemoryRouter>);
}
function renderPortalAndArticle(initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries'], initialIndex: number) {
  return render(<MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}><LocationProbe /><HistoryBackProbe /><Routes><Route path="/kb/public/:token" element={<PublicKnowledgeBase />} /><Route path="/kb/public/:token/article/:articleId" element={<PublicKBArticle />} /></Routes></MemoryRouter>);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => {
  api.getKbPortalCategories.mockResolvedValue(categories);
  api.getKbPortalArticles.mockResolvedValue([summary]);
  api.getKbPortalArticle.mockResolvedValue(article);
  document.title = 'Föregående titel';
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PublicKnowledgeBase', () => {
  it('visar publicerade artikelkort och saknar interna redigeringskontroller', async () => {
    renderPortal();
    expect(await screen.findByRole('link', { name: /Anslut till Wi-Fi/i })).toHaveAttribute('href', '/kb/public/token-1/article/wifi-guide');
    expect(screen.getAllByText('Nätverk')).not.toHaveLength(0);
    expect(screen.getByText('Instruktion')).toBeInTheDocument();
    expect(screen.getByText('Wi-Fi')).toBeInTheDocument();
    expect(screen.getByText('Så ansluter du säkert.')).toHaveClass('line-clamp-2');
    expect(screen.queryByText('Tom kategori')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ny artikel|skapa|redigera|importera|dela/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alla artiklar/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Nätverk/i })).toHaveAttribute('aria-pressed', 'false');
    expect(document.title).toBe('IT Kunskapsbas');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
  });

  it('läser sök och kategori från URL och behåller dem vid artikelnavigering', async () => {
    renderPortal('/kb/public/token-1?search=wifi&category=network');
    await screen.findByText('Anslut till Wi-Fi');
    expect(api.getKbPortalArticles).toHaveBeenLastCalledWith('token-1', { search: 'wifi', category_id: 'network' });
    fireEvent.click(screen.getByRole('link', { name: /Anslut till Wi-Fi/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/kb/public/token-1/article/wifi-guide?search=wifi&category=network');
  });

  it('uppdaterar kategori-parametern och hämtar filtrerad lista', async () => {
    renderPortal();
    await screen.findByText('Anslut till Wi-Fi');
    fireEvent.click(screen.getByRole('button', { name: /Nätverk/i }));
    await waitFor(() => expect(api.getKbPortalArticles).toHaveBeenLastCalledWith('token-1', { search: undefined, category_id: 'network' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?category=network');
    expect(screen.getByRole('button', { name: /Alla artiklar/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Nätverk/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('debouncar skriven sökning innan den skrivs till URL och hämtas', async () => {
    renderPortal();
    await screen.findByText('Anslut till Wi-Fi');
    fireEvent.change(screen.getByRole('textbox', { name: 'Sök i kunskapsbasen' }), { target: { value: 'vpn' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/kb/public/token-1');
    await waitFor(() => expect(api.getKbPortalArticles).toHaveBeenLastCalledWith('token-1', { search: 'vpn', category_id: undefined }), { timeout: 1500 });
    expect(screen.getByTestId('location')).toHaveTextContent('?search=vpn');
  });

  it('har mobil kategori-väljare som uppdaterar URL och artikelhämtning', async () => {
    renderPortal();
    await screen.findByText('Anslut till Wi-Fi');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrera på kategori' }), { target: { value: 'network' } });
    await waitFor(() => expect(api.getKbPortalArticles).toHaveBeenLastCalledWith('token-1', { search: undefined, category_id: 'network' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?category=network');
  });

  it('fokuserar sökfältet med / när fokus inte redan är i ett fält', async () => {
    renderPortal();
    await screen.findByText('Anslut till Wi-Fi');
    fireEvent.keyDown(document, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Sök i kunskapsbasen' })).toHaveFocus();
  });

  it('visar ett tydligt tomt läge när inga publicerade artiklar matchar', async () => {
    api.getKbPortalArticles.mockResolvedValueOnce([]);
    renderPortal();
    expect(await screen.findByText('Inga publicerade artiklar ännu')).toBeInTheDocument();
  });

  it('visar laddningsläge medan portaldata väntar', () => {
    api.getKbPortalCategories.mockReturnValueOnce(new Promise(() => {}));
    api.getKbPortalArticles.mockReturnValueOnce(new Promise(() => {}));
    renderPortal();
    expect(screen.getByLabelText('Laddar artiklar')).toBeInTheDocument();
  });

  it('visar ett återförsökningsbart fel när portalen inte går att läsa', async () => {
    api.getKbPortalArticles.mockRejectedValueOnce(new Error('offline'));
    renderPortal();
    expect(await screen.findByText('Kunde inte hämta kunskapsbasen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Försök igen' })).toBeInTheDocument();
  });

  it('ignorerar ett sent svar från försöket före retry', async () => {
    const staleCategories = deferred<typeof categories>();
    api.getKbPortalCategories.mockImplementationOnce(() => staleCategories.promise).mockResolvedValueOnce(categories);
    api.getKbPortalArticles.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([summary]);
    renderPortal();
    expect(await screen.findByText('Kunde inte hämta kunskapsbasen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(await screen.findByRole('link', { name: /Anslut till Wi-Fi/i })).toBeInTheDocument();
    await act(async () => { staleCategories.resolve([{ id: 'stale', name: 'Gammal kategori', color: null, article_count: 1 }]); });
    expect(screen.queryByRole('button', { name: /Gammal kategori/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nätverk/i })).toBeInTheDocument();
  });
});

describe('PublicKBArticle', () => {
  it('hämtar artikel med route-parametrar, renderar innehåll och går tillbaka i portalhistoriken', async () => {
    renderPortalAndArticle([
      '/före-portalen',
      '/kb/public/token-1?search=wifi&category=network',
      { pathname: '/kb/public/token-1/article/wifi-guide', search: '?search=wifi&category=network', state: { fromPortal: true } },
    ], 2);
    expect(await screen.findByRole('heading', { name: 'Anslut till Wi-Fi' })).toBeInTheDocument();
    expect(api.getKbPortalArticle).toHaveBeenCalledWith('token-1', 'wifi-guide');
    expect(screen.getByText('Steg ett: välj nätverket.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tillbaka till artiklar/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/kb/public/token-1?search=wifi&category=network');
    fireEvent.click(screen.getByRole('button', { name: 'Historik bakåt' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/före-portalen');
  });

  it('bevarar query för en direktlänk och ersätter artikeln innan tillbaka-navigering', async () => {
    renderPortalAndArticle([
      '/före-portalen',
      '/kb/public/token-1/article/wifi-guide?search=wifi&category=network',
    ], 1);
    expect(await screen.findByRole('heading', { name: 'Anslut till Wi-Fi' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tillbaka till artiklar/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/kb/public/token-1?search=wifi&category=network');
    fireEvent.click(screen.getByRole('button', { name: 'Historik bakåt' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/före-portalen');
  });

  it('visar säkert fel för en ogiltig artikellänk', async () => {
    api.getKbPortalArticle.mockRejectedValueOnce(new Error('not found'));
    renderArticle();
    expect(await screen.findByRole('heading', { name: 'Artikeln hittades inte' })).toBeInTheDocument();
    expect(screen.queryByText('Steg ett: välj nätverket.')).not.toBeInTheDocument();
  });
});
