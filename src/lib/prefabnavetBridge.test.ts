import { describe, expect, it, vi } from 'vitest';
import {
  PREFABNAVET_OPEN_SEARCH_MESSAGE,
  PREFABNAVET_ORIGIN,
  PREFABNAVET_SEARCH_FRAME_NAME,
  postPrefabnavetOpenSearch,
} from './prefabnavetBridge';

describe('Prefabnavet search bridge', () => {
  it('posts the versioned search request to the fixed Prefabnavet origin', () => {
    const postMessage = vi.fn();

    expect(postPrefabnavetOpenSearch(
      { postMessage } as unknown as Pick<Window, 'postMessage'>,
      true,
      `${PREFABNAVET_ORIGIN}/overview`,
      PREFABNAVET_SEARCH_FRAME_NAME,
    )).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      PREFABNAVET_OPEN_SEARCH_MESSAGE,
      PREFABNAVET_ORIGIN,
    );
    expect(PREFABNAVET_OPEN_SEARCH_MESSAGE).toEqual({
      type: 'prefabnavet.open-search',
      version: 1,
    });
  });

  it.each([
    [false, `${PREFABNAVET_ORIGIN}/overview`, PREFABNAVET_SEARCH_FRAME_NAME],
    [true, 'https://evil.example/', PREFABNAVET_SEARCH_FRAME_NAME],
    [true, 'not a url', PREFABNAVET_SEARCH_FRAME_NAME],
    [true, `${PREFABNAVET_ORIGIN}/overview`, ''],
  ])('fails closed without trusted embedding and search capability', (isEmbedded, referrer, frameName) => {
    const postMessage = vi.fn();

    expect(postPrefabnavetOpenSearch(
      { postMessage } as unknown as Pick<Window, 'postMessage'>,
      isEmbedded,
      referrer,
      frameName,
    )).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
