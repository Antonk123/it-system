import { describe, expect, it } from 'vitest';
import type { FilterView } from '@/types/filterView';
import { archiveFilterViewMatches } from './archiveFilterView';

const view = (filters: FilterView['filters']): FilterView => ({
  id: 'saved-view', name: 'Sparad vy', isDefault: false, filters,
  createdAt: '', updatedAt: '',
});

describe('Arkivets markering av sparad vy', () => {
  it('markerar aldrig Aktiva ärenden på avslutade även om URL bär aktiv status', () => {
    const active = view({ status: ['open', 'in-progress', 'waiting'] });
    expect(archiveFilterViewMatches(active, new URLSearchParams('page=1&limit=10'))).toBe(false);
    expect(archiveFilterViewMatches(active, new URLSearchParams('status=open,in-progress,waiting'))).toBe(false);
  });

  it('markerar en matchande avslutad vy oberoende av sidnummer och inaktuella taggparametrar', () => {
    expect(archiveFilterViewMatches(view({ status: ['closed'], priority: 'high' }),
      new URLSearchParams('priority=high&tags=b,a&page=2&limit=10'))).toBe(true);
  });

  it('markerar inte en sparad vy när URL-filtren ändrats', () => {
    expect(archiveFilterViewMatches(view({ status: ['closed'], search: 'skrivare' }),
      new URLSearchParams('search=mobil'))).toBe(false);
  });

  it('kräver avslutningsdatum för en datumfiltrerad vy trots URL:s dateField', () => {
    const params = new URLSearchParams('dateFrom=2026-01-01&dateField=created_at');
    expect(archiveFilterViewMatches(view({ dateFrom: '2026-01-01' }), params)).toBe(false);
    expect(archiveFilterViewMatches(view({ dateFrom: '2026-01-01', dateField: 'closed_at' }), params)).toBe(true);
  });

  it('tillåter tillämpade generella filter utan status och lämnar omarkerat utan vald vy', () => {
    expect(archiveFilterViewMatches(view({ category: 'it' }), new URLSearchParams('category=it'))).toBe(true);
    expect(archiveFilterViewMatches(null, new URLSearchParams())).toBe(false);
  });
});
