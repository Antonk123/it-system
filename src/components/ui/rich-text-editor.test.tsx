// @vitest-environment jsdom
/**
 * Regressionsskydd för produktionskraschen på /submit-ticket (2026-08-19).
 *
 * Symptom: sidan föll till ErrorBoundary ("Något gick fel") med
 *   TypeError: Cannot read properties of null (reading 'cached')
 *     at DOMSerializer.fromSchema
 *     at getHTMLFromFragment
 *     at Editor.getHTML
 *     at rich-text-editor.tsx  (value-sync-effekten)
 *
 * Orsak: @tiptap/react:s EditorInstanceManager beväpnar en 1 ms självdestruktion
 * i sin konstruktor (StrictMode-skydd). Hinner inte React spola sina passiva
 * effekter inom den millisekunden hinner timern förstöra exakt den editor-instans
 * som React redan renderat med. Tiptaps Editor.destroy() nollar `schema`,
 * `extensionManager` och `commandManager` — men `state` lever kvar, så
 * getHTML() (som är `getHTMLFromFragment(this.state.doc.content, this.schema)`)
 * kastar i stället för att returnera tomt.
 *
 * Invarianten som testas: komponenten får ALDRIG anropa metoder på en förstörd
 * editor-instans. Det spelar ingen roll VARFÖR instansen är förstörd — en
 * förstörd instans i handen ska ge en no-op, inte en kraschad sida.
 *
 * Testet river instansen ur DOM:en (Tiptap sätter `view.dom.editor`) och
 * förstör den bakom ryggen på React, vilket är exakt det tillstånd prod hamnade i.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { useState } from 'react';

vi.mock('@/lib/api', () => ({
  api: { uploadKbImage: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { RichTextEditor } from './rich-text-editor';

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

type EditorHost = HTMLElement & { editor?: { destroy: () => void; isDestroyed: boolean } };

/** Speglar hur PublicTicketForm använder editorn: kontrollerad + required. */
function Harness({ required = false }: { required?: boolean }) {
  const [value, setValue] = useState('<p>hej</p>');
  return (
    <>
      <RichTextEditor value={value} onChange={setValue} required={required} />
      <button type="button" onClick={() => setValue('<p>externt satt värde</p>')}>
        sätt externt
      </button>
    </>
  );
}

function grabEditor(): NonNullable<EditorHost['editor']> {
  const host = document.querySelector('.ProseMirror') as EditorHost | null;
  expect(host, 'ProseMirror-elementet ska finnas i DOM:en').not.toBeNull();
  const editor = host!.editor;
  expect(editor, 'Tiptap ska ha satt view.dom.editor').toBeTruthy();
  return editor!;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RichTextEditor mot en förstörd editor-instans', () => {
  it('kraschar inte när ett externt value kommer in efter att instansen förstörts', () => {
    render(<Harness />);
    const editor = grabEditor();

    // Simulerar @tiptap/react:s schemalagda destroy som hinner före effekt-spolningen.
    act(() => {
      editor.destroy();
    });
    expect(editor.isDestroyed).toBe(true);

    // Value-sync-effekten (rich-text-editor.tsx) körde tidigare editor.getHTML()
    // rakt på den förstörda instansen -> TypeError ... reading 'cached'.
    expect(() => {
      act(() => {
        screen.getByText('sätt externt').click();
      });
    }).not.toThrow();
  });

  it('kraschar inte vid omrendering när required=true (dolda inputens getText)', () => {
    // PublicTicketForm skickar required — den dolda valideringsinputen läser
    // editor.getText() UNDER RENDER. getText() slår upp textSerializers ur
    // this.schema, så den kraschar på samma nollade fält som getHTML().
    render(<Harness required />);
    const editor = grabEditor();

    act(() => {
      editor.destroy();
    });

    expect(() => {
      act(() => {
        screen.getByText('sätt externt').click();
      });
    }).not.toThrow();
  });
});

describe('bildadapter i den riktiga editorn', () => {
  it('behåller text och båda bilderna, skickar originalfilen och använder aldrig KB implicit', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const { api } = await import('@/lib/api');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 120, height: 60, close: vi.fn() })));
    const add = vi.fn(async (file: File) => `/images/${file.name}`);
    const { container } = render(<RichTextEditor value="<p>Viktig text</p>" onChange={() => {}} imageAdapter={{ add }} />);
    const input = container.querySelector('input[type=file]')!;
    const first = new File(['original'], 'one.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(() => expect(container.querySelectorAll('.ProseMirror img')).toHaveLength(1));
    const second = new File(['second'], 'two.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(container.querySelectorAll('.ProseMirror img')).toHaveLength(2));
    expect(add.mock.calls[0][0]).toBe(first);
    expect(container.querySelector('.ProseMirror')).toHaveTextContent('Viktig text');
    expect(api.uploadKbImage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('behåller text när bildadaptern avvisar filen', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const { toast } = await import('sonner');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })));
    const { container } = render(<RichTextEditor value="<p>Behåll mig</p>" onChange={() => {}} imageAdapter={{ add: async () => { throw new Error('Nätverksfel'); } }} />);
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'one.png', { type: 'image/png' })] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nätverksfel'));
    expect(container.querySelector('.ProseMirror')).toHaveTextContent('Behåll mig');
    expect(container.querySelectorAll('.ProseMirror img')).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
