/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const packagePath = 'public/theme-kit/1.0.0';
const bridge = read(`${packagePath}/prefabnavet-theme-bridge.js`);
const navetOrigin = 'https://navet.prefabmastarna.se';

function setup(embedded = true) {
  const attributes = new Map<string, string>();
  const parent = { postMessage: vi.fn() };
  let listener: (event: object) => void = () => {};
  let timeout: () => void = () => {};
  const window = {
    parent: parent as object,
    addEventListener: (_name: string, callback: typeof listener) => { listener = callback; },
    setTimeout: (callback: () => void) => { timeout = callback; return 1; },
    clearTimeout: vi.fn(),
  };
  if (!embedded) window.parent = window;
  runInNewContext(bridge, {
    window, URL, Object,
    document: {
      referrer: `${navetOrigin}/`,
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
      },
    },
  });
  return {
    attributes, parent, timeout: () => timeout(),
    send: (data: object, origin = navetOrigin, source: object = parent) => listener({ data, origin, source }),
  };
}
const appearance = (theme = 'dark', palette = 'terminal') => ({
  type: 'prefabnavet.appearance', version: 1, theme, palette,
});

describe('Prefabnavet theme integration', () => {
  it('ships the unchanged versioned package and loads it before React', () => {
    const manifest = JSON.parse(read(`${packagePath}/manifest.json`)) as {
      packageVersion: string; files: Record<string, { sha256: string }>;
    };
    expect(manifest.packageVersion).toBe('1.0.0');
    for (const [name, { sha256 }] of Object.entries(manifest.files)) {
      expect(createHash('sha256').update(readFileSync(resolve(root, packagePath, name))).digest('hex')).toBe(sha256);
    }
    const html = read('index.html');
    const cssIndex = html.indexOf('/theme-kit/1.0.0/prefabnavet-theme.css');
    const bridgeIndex = html.indexOf('/theme-kit/1.0.0/prefabnavet-theme-bridge.js');
    expect(cssIndex).toBeGreaterThan(-1);
    expect(bridgeIndex).toBeGreaterThan(cssIndex);
    expect(html.indexOf('/src/main.tsx')).toBeGreaterThan(bridgeIndex);
  });

  it('keeps standalone preferences untouched', () => {
    const app = setup(false);
    app.send(appearance());
    expect(app.attributes.size).toBe(0);
    expect(app.parent.postMessage).not.toHaveBeenCalled();
  });

  it('announces readiness and follows every palette in both modes', () => {
    const app = setup();
    expect(app.parent.postMessage).toHaveBeenCalledWith({ type: 'prefabnavet.appearance-ready', version: 1 }, navetOrigin);
    for (const palette of ['bibliotek', 'violett', 'odysseus', 'terminal', 'gpt', 'claude']) {
      for (const theme of ['dark', 'light']) {
        app.send(appearance(theme, palette));
        expect(app.attributes.get('data-prefabnavet-embedded')).toBe('true');
        expect(app.attributes.get('data-prefabnavet-theme')).toBe(theme);
        expect(app.attributes.get('data-prefabnavet-palette')).toBe(palette);
        expect(app.attributes.has('data-prefabnavet-theme-pending')).toBe(false);
      }
    }
  });

  it('rejects untrusted senders and malformed appearance messages', () => {
    const app = setup();
    app.send(appearance(), 'https://example.org');
    app.send(appearance(), navetOrigin, {});
    app.send(appearance('system'));
    app.send(appearance('dark', 'unknown'));
    app.send({ ...appearance(), version: 2 });
    app.send({ ...appearance(), extra: true });
    expect(app.attributes.has('data-prefabnavet-embedded')).toBe(false);
    app.timeout();
    expect(app.attributes.size).toBe(0);
  });

  it('keeps waiting and high-priority badge text at WCAG AA contrast in every palette', () => {
    const rgb = (hsl: string) => {
      const [h, s, l] = hsl.replaceAll('%', '').split(' ').map(Number);
      const lightness = l / 100;
      const amplitude = (s / 100) * Math.min(lightness, 1 - lightness);
      return [0, 8, 4].map(offset => {
        const k = (offset + h / 30) % 12;
        return lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      });
    };
    const luminance = (color: number[]) => color.reduce((sum, channel, index) =>
      sum + [0.2126, 0.7152, 0.0722][index] *
      (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
    const palettes = [...read('src/prefabnavet-theme.css').matchAll(/(html[^{}]+)\{([^}]+)/g)]
      .filter(([, selector]) => selector.includes('data-prefabnavet-palette'));
    expect(palettes).toHaveLength(12);
    for (const [, selector, body] of palettes) {
      const colors = Object.fromEntries([...body.matchAll(/--([\w-]+): ([\d.]+ [\d.]+% [\d.]+%);/g)]
        .map(([, token, value]) => [token, rgb(value)]));
      // These opacity values match TicketQueueTable's waiting and high badges.
      for (const [token, opacity] of [['status-waiting', 0.12], ['priority-high', 0.14]] as const) {
        const text = colors[token];
        const background = text.map((channel, index) =>
          channel * opacity + colors.card[index] * (1 - opacity));
        const [darker, lighter] = [luminance(text), luminance(background)].sort((a, b) => a - b);
        expect((lighter + 0.05) / (darker + 0.05), `${selector}: ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

});
