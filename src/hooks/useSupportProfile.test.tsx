// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSupportProfile } from './useSupportProfile';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Support profile bridge', () => {
  it.each(['https://navet.prefabmastarna.se/support', 'https://ticket.prefabmastarna.se/submit-ticket?embed=1'])('accepts only the actual parent at the trusted referrer origin and bounded raster portraits (referrer %s)', (referrer) => {
    const parent = { postMessage: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer);
    const { result } = renderHook(() => useSupportProfile(true));
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'prefabnavet.support-ready', version: 1 }, referrer.includes('https://navet.') ? 'https://navet.prefabmastarna.se' : '*');
    const profile = { type: 'prefabnavet.support-profile', version: 1, name: 'Anna', email: 'anna@example.com', photo: 'data:image/png;base64,aGVsbG8=' };
    const send = (origin: string, source: Window, data = profile) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin, source, data })); });
    send('https://evil.example', parent);
    send('https://navet.prefabmastarna.se', window);
    expect(result.current).toBeNull();
    send('https://navet.prefabmastarna.se', parent);
    expect(result.current).toEqual({ name: 'Anna', email: 'anna@example.com', photo: profile.photo });
    send('https://navet.prefabmastarna.se', parent, { ...profile, photo: 'https://tracker.example/photo' });
    expect(result.current?.photo).toBeNull();
  });
});
