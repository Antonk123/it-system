/* Prefabnavet Theme Bridge — protocol version 1.
 * Load this script early in an external portal document. It is intentionally
 * inert in a top-level browsing context and never persists appearance state.
 */
(function () {
    'use strict';

    var NAVET_ORIGIN = 'https://navet.prefabmastarna.se';
    var READY_MESSAGE = 'prefabnavet.appearance-ready';
    var APPEARANCE_MESSAGE = 'prefabnavet.appearance';
    var PROTOCOL_VERSION = 1;
    var PENDING_TIMEOUT_MS = 750;
    var THEMES = ['light', 'dark'];
    var PALETTES = ['bibliotek', 'violett', 'odysseus', 'terminal', 'gpt', 'claude'];

    if (window.parent === window) return;

    var root = document.documentElement;
    var pendingTimer = null;

    function referrerOrigin() {
        if (!document.referrer) return '';
        try {
            return new URL(document.referrer).origin;
        } catch (error) {
            return '';
        }
    }

    function clearPending() {
        root.removeAttribute('data-prefabnavet-theme-pending');
        if (pendingTimer !== null) {
            window.clearTimeout(pendingTimer);
            pendingTimer = null;
        }
    }

    function isPlainObject(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        var prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }

    function hasExactAppearanceKeys(value) {
        return Object.keys(value).sort().join(',') === 'palette,theme,type,version';
    }

    function handleMessage(event) {
        if (event.origin !== NAVET_ORIGIN || event.source !== window.parent) return;
        var data = event.data;
        if (!isPlainObject(data) || !hasExactAppearanceKeys(data) ||
                data.type !== APPEARANCE_MESSAGE ||
                data.version !== PROTOCOL_VERSION) return;
        if (THEMES.indexOf(data.theme) === -1 || PALETTES.indexOf(data.palette) === -1) return;

        root.setAttribute('data-prefabnavet-embedded', 'true');
        root.setAttribute('data-prefabnavet-theme', data.theme);
        root.setAttribute('data-prefabnavet-palette', data.palette);
        clearPending();
    }

    if (referrerOrigin() === NAVET_ORIGIN) {
        root.setAttribute('data-prefabnavet-theme-pending', 'true');
        pendingTimer = window.setTimeout(clearPending, PENDING_TIMEOUT_MS);
    }

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({
        type: READY_MESSAGE,
        version: PROTOCOL_VERSION
    }, NAVET_ORIGIN);
}());
