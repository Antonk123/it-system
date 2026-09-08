import { describe, expect, it } from 'vitest';
import { getTicketScope, ticketTabLink, ticketViews } from './ticketNavigation';

describe('statusflikar', () => {
  it.each([
    ['', ['open', 'in-progress', 'waiting']],
    ['open', ['open']],
    ['in-progress', ['in-progress']],
    ['waiting', ['waiting']],
    ['resolved', ['resolved', 'closed']],
    ['closed', ['resolved', 'closed']],
    ['open,waiting', ['open', 'in-progress', 'waiting']],
  ])('ger ett synligt urval för gammal status %s', (status, expected) => {
    expect(getTicketScope('/tickets', new URLSearchParams({status})).statuses).toEqual(expected);
  });
  it('bevarar mina och vanliga filter, återställer sida och avvecklade filter', () => {
    const link = ticketTabLink(ticketViews[2], '/my-tickets', '?category=c1&search=wifi&page=8&tags=old&tagMode=and');
    const url = new URL(link, 'http://test');
    expect(url.pathname).toBe('/tickets');
    expect(Object.fromEntries(url.searchParams)).toEqual({category:'c1',search:'wifi',mine:'1',status:'in-progress'});
    expect(getTicketScope(url.pathname, url.searchParams)).toEqual({tab:'in-progress',mine:true,statuses:['in-progress']});
  });
  it('inkluderar lösta i arkivet även när gammal länk säger stängd', () => {
    expect(getTicketScope('/archive', new URLSearchParams('status=closed&mine=1'))).toEqual({tab:'completed',mine:true,statuses:['resolved','closed']});
  });
});
