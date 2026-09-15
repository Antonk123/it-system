// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ArchitectureMap from './ArchitectureMap';

const state = vi.hoisted(() => ({ role: 'admin', requestBlob: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/lib/api', () => ({ api: { requestBlob: state.requestBlob } }));
const html = '<!doctype html><html lang="sv"><body>Arkitekturkarta</body></html>';
const response = () => ({ type: 'text/html; charset=utf-8', text: async () => html });
const mount = (path = '/architecture-map') => render(<MemoryRouter initialEntries={[path]}><ArchitectureMap /></MemoryRouter>);

beforeEach(() => { state.role = 'admin'; state.requestBlob.mockReset(); });
afterEach(cleanup);

describe('Arkitekturkarta – skyddad värdvy', () => {
  it('hämtar inte adminartefakten för en vanlig användare', () => {
    state.role = 'user'; mount();
    expect(screen.getByRole('heading', { name: 'Administratörsbehörighet krävs' })).toBeVisible();
    expect(state.requestBlob).not.toHaveBeenCalled();
    expect(screen.queryByTitle('IT-Ticket – arkitekturkarta')).toBeNull();
  });

  it('visar laddning följt av den autentiserade kartan och avbryter vid avmontering', async () => {
    let resolve: (value: ReturnType<typeof response>) => void;
    state.requestBlob.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = mount();
    expect(screen.getByRole('status')).toHaveTextContent('Laddar arkitekturkartan');
    resolve!(response());
    const frame = await screen.findByTitle('IT-Ticket – arkitekturkarta');
    expect(frame).toHaveAttribute('srcdoc', html);
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
    expect(screen.getByRole('link', { name: 'Till inställningar' })).toHaveAttribute('href', '/settings');
    const [endpoint, options] = state.requestBlob.mock.calls[0];
    expect(endpoint).toBe('/architecture-map');
    view.unmount();
    expect(options.signal.aborted).toBe(true);
  });

  it('erbjuder nytt försök efter nätverksfel', async () => {
    state.requestBlob.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Kartan kunde inte laddas');
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }));
    expect(await screen.findByTitle('IT-Ticket – arkitekturkarta')).toBeVisible();
    expect(state.requestBlob).toHaveBeenCalledTimes(2);
  });

  it('visar fel i stället för att bädda in ett oväntat svar', async () => {
    state.requestBlob.mockResolvedValue({ type: 'application/json', text: async () => '{}' });
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByTitle('IT-Ticket – arkitekturkarta')).toBeNull();
  });

  it('behåller adminhämtning och anger embed-läge utan värdens tillbaka-länk', async () => {
    state.requestBlob.mockResolvedValue(response()); mount('/architecture-map?embed=1');
    await waitFor(() => expect(screen.getByTitle('IT-Ticket – arkitekturkarta')).toHaveAttribute('name', 'architecture-map-embed'));
    expect(screen.queryByRole('link', { name: 'Till inställningar' })).toBeNull();
    expect(state.requestBlob).toHaveBeenCalledTimes(1);
  });
});
