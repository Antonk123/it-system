// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

vi.mock('@/lib/api', () => ({
  api: {
    getSharedTicket: vi.fn(),
  },
}));

import { api, SharedTicketData } from '@/lib/api';
import SharedTicket from './SharedTicket';

const baseTicket: SharedTicketData = {
  ticket: {
    id: 't1',
    title: 'Skrivaren fungerar inte',
    description: '<p>Beskrivning</p>',
    status: 'open',
    priority: 'medium',
    solution: null,
    notes: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
    resolved_at: null,
    closed_at: null,
    category: null,
  },
  requester: null,
  attachments: [],
  checklistItems: [],
};

function renderSharedTicket(token = 'tok-1') {
  return render(
    <MemoryRouter initialEntries={[`/shared/${token}`]}>
      <Routes>
        <Route path="/shared/:token" element={<SharedTicket />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('SharedTicket — lyckat svar', () => {
  it('renderar ärendets titel och "Länken är giltig till"-raden när share_expires_at finns', async () => {
    (api.getSharedTicket as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseTicket,
      share_expires_at: '2026-09-01T00:00:00Z',
    });

    renderSharedTicket();

    expect(await screen.findByText('Skrivaren fungerar inte')).toBeInTheDocument();
    expect(screen.getByText(/Länken är giltig till/)).toBeInTheDocument();
  });

  it('renderar INTE giltighetsraden när share_expires_at saknas (bakåtkompatibelt)', async () => {
    (api.getSharedTicket as ReturnType<typeof vi.fn>).mockResolvedValue(baseTicket);

    renderSharedTicket();

    expect(await screen.findByText('Skrivaren fungerar inte')).toBeInTheDocument();
    expect(screen.queryByText(/Länken är giltig till/)).toBeNull();
  });
});

describe('SharedTicket — felsvar', () => {
  it('visar det uppdaterade felmeddelandet vid ogiltig/utgången länk', async () => {
    (api.getSharedTicket as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Request failed (404)'));

    renderSharedTicket('utgången-token');

    expect(await screen.findByText('Delningslänken är ogiltig eller har gått ut.')).toBeInTheDocument();
  });
});
