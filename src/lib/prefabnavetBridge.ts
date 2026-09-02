export const PREFABNAVET_ORIGIN = 'https://navet.prefabmastarna.se';
export const PREFABNAVET_SEARCH_FRAME_NAME = 'prefabnavet-search-v1';

export const PREFABNAVET_OPEN_SEARCH_MESSAGE = {
  type: 'prefabnavet.open-search',
  version: 1,
} as const;

function hasTrustedPrefabnavetReferrer(referrer: string): boolean {
  try {
    return new URL(referrer).origin === PREFABNAVET_ORIGIN;
  } catch {
    return false;
  }
}

export function postPrefabnavetOpenSearch(
  parentWindow: Pick<Window, 'postMessage'>,
  isEmbedded: boolean,
  referrer: string,
  frameName: string,
): boolean {
  if (
    !isEmbedded
    || frameName !== PREFABNAVET_SEARCH_FRAME_NAME
    || !hasTrustedPrefabnavetReferrer(referrer)
  ) {
    return false;
  }

  parentWindow.postMessage(PREFABNAVET_OPEN_SEARCH_MESSAGE, PREFABNAVET_ORIGIN);
  return true;
}

export function forwardSearchToPrefabnavet(): boolean {
  return postPrefabnavetOpenSearch(
    window.parent,
    window.parent !== window,
    document.referrer,
    window.name,
  );
}
