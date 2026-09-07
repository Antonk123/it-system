import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'public/stale-entry.js'), 'utf8');

function run(href: string) {
  const replace = vi.fn();
  const append = vi.fn();
  runInNewContext(source, {
    URL,
    Date: { now: () => 1800000000000 },
    window: { location: { href, replace } },
    document: {
      readyState: 'complete',
      createElement: () => ({ textContent: '' }),
      body: { append },
    },
  });
  return { replace, append };
}

describe('removed entry bundle recovery', () => {
  it('requests fresh HTML without losing the route, query or fragment', () => {
    const { replace, append } = run('https://ticket.prefabmastarna.se/submit-ticket?category=it#form');
    expect(replace).toHaveBeenCalledWith('https://ticket.prefabmastarna.se/submit-ticket?category=it&_app_update=1800000000000#form');
    expect(append).not.toHaveBeenCalled();
  });

  it('shows a recovery action instead of repeatedly reloading stale HTML', () => {
    const { replace, append } = run('https://ticket.prefabmastarna.se/submit-ticket?_app_update=1799999999000');
    expect(replace).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0][1].textContent).toBe('Ladda om Support');
  });

  it('can recover again when an old update URL is reopened later', () => {
    const { replace } = run('https://ticket.prefabmastarna.se/tickets/new?_app_update=1799999900000');
    expect(replace).toHaveBeenCalledWith('https://ticket.prefabmastarna.se/tickets/new?_app_update=1800000000000');
  });
});
