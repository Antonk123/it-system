// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HtmlRenderer } from './HtmlRenderer';

afterEach(cleanup);

const imgSrc = (html: string) => render(<HtmlRenderer content={html} />).container.querySelector('img')?.getAttribute('src');

describe('HtmlRenderer — externa bilder blockeras', () => {
  it('behåller relativa sökvägar', () => {
    expect(imgSrc('<img src="/api/attachments/file/1">')).toBe('/api/attachments/file/1');
  });

  it('tar bort extern https-källa', () => {
    expect(imgSrc('<img src="https://tracker.example/pixel.png">')).toBeNull();
  });

  it('tar bort protokoll-relativ källa (//host/…)', () => {
    expect(imgSrc('<img src="//tracker.example/pixel.png">')).toBeNull();
  });

  it('tar bort källa som bara börjar med den egna originens namn', () => {
    expect(imgSrc(`<img src="${window.location.origin}.evil.example/pixel.png">`)).toBeNull();
  });
});

describe('HtmlRenderer', () => {
  it('renderar inget för tomt innehåll', () => {
    expect(render(<HtmlRenderer content="" />).container.firstChild).toBeNull();
  });

  it('tar bort script och händelseattribut', () => {
    const { container } = render(<HtmlRenderer content={'<p onclick="x()">hej</p><script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('p')?.hasAttribute('onclick')).toBe(false);
  });
});
