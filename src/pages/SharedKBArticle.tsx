import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Folder, AlertCircle, Calendar } from 'lucide-react';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { api, KbArticleRow } from '@/lib/api';

const SharedKBArticle = () => {
  const { token } = useParams<{ token: string }>();
  const [article, setArticle] = useState<KbArticleRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('Ingen länk angiven'); setIsLoading(false); return; }
    api.getPublicKbArticle(token)
      .then(setArticle)
      .catch(() => setError('Länken är ogiltig eller har tagits bort.'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  if (isLoading) {
    return (
      <>
        <style>{fonts}</style>
        <div style={pageStyle} className="min-h-dvh flex items-center justify-center">
          <div className="text-center space-y-4">
            <div style={{ borderColor: 'rgba(255,255,255,0.15)', borderTopColor: '#a78bfa' }} className="w-10 h-10 mx-auto rounded-full border-2 animate-spin" />
            <p style={{ fontFamily: bodyFont, color: '#9ca3af', fontSize: 14 }}>Laddar artikel…</p>
          </div>
        </div>
      </>
    );
  }

  if (error || !article) {
    return (
      <>
        <style>{fonts}</style>
        <div style={pageStyle} className="min-h-dvh flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-5">
            <div style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }} className="w-14 h-14 mx-auto rounded-full flex items-center justify-center">
              <AlertCircle style={{ color: '#f87171' }} className="w-7 h-7" />
            </div>
            <div>
              <h2 style={{ fontFamily: bodyFont, color: '#f1f5f9', fontWeight: 600, fontSize: 18, marginBottom: 6 }}>Sidan hittades inte</h2>
              <p style={{ fontFamily: bodyFont, color: '#9ca3af', fontSize: 14, lineHeight: 1.6 }}>{error || 'Länken verkar vara ogiltig.'}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{fonts + proseStyles}</style>

      <div style={pageStyle} className="min-h-dvh">

        {/* Top bar */}
        <header style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: 'rgba(15,15,20,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }} className="sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }} className="w-7 h-7 rounded-md flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-white" />
              </div>
              <span style={{ fontFamily: bodyFont, color: '#e2e8f0', fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>IT Knowledge Base</span>
            </div>
            {article.category_name && (
              <span
                style={{
                  fontFamily: bodyFont,
                  backgroundColor: article.category_color ? article.category_color + '20' : 'rgba(124,58,237,0.15)',
                  border: `1px solid ${article.category_color ? article.category_color + '50' : 'rgba(124,58,237,0.35)'}`,
                  color: article.category_color || '#a78bfa',
                  fontSize: 12,
                  fontWeight: 500,
                  padding: '3px 10px',
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Folder className="w-3 h-3" style={{ display: 'inline', flexShrink: 0 }} />
                {article.category_name}
              </span>
            )}
          </div>
        </header>

        {/* Hero */}
        <div style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="max-w-3xl mx-auto px-6 pt-14 pb-12">
            <h1
              style={{ fontFamily: headingFont, lineHeight: 1.2, color: '#f8fafc', fontWeight: 700 }}
              className="text-3xl sm:text-4xl md:text-[2.75rem] mb-5"
            >
              {article.title}
            </h1>
            <div style={{ color: '#64748b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar className="w-3.5 h-3.5" />
              <span style={{ fontFamily: bodyFont }}>Uppdaterad {formatDate(article.updated_at)}</span>
            </div>
          </div>
        </div>

        {/* Article body */}
        <main className="max-w-3xl mx-auto px-6 py-12">
          {article.content ? (
            <div className="kb-prose">
              <HtmlRenderer content={article.content} />
            </div>
          ) : (
            <p style={{ fontFamily: bodyFont, color: '#64748b', fontStyle: 'italic', fontSize: 14 }}>Inget innehåll ännu.</p>
          )}
        </main>

        {/* Footer */}
        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(15,15,20,0.6)' }} className="mt-8">
          <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }} className="w-7 h-7 rounded-md flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p style={{ fontFamily: bodyFont, color: '#e2e8f0', fontWeight: 600, fontSize: 14, lineHeight: 1 }}>IT Knowledge Base</p>
                <p style={{ fontFamily: bodyFont, color: '#64748b', fontSize: 12, marginTop: 3 }}>Internt supportsystem</p>
              </div>
            </div>
            <p style={{ fontFamily: bodyFont, color: '#64748b', fontSize: 12, textAlign: 'center', lineHeight: 1.6 }} className="sm:text-right max-w-xs">
              Behöver du mer hjälp? Kontakta IT-avdelningen<br />
              för att logga ett ärende i systemet.
            </p>
          </div>
        </footer>

      </div>
    </>
  );
};

const bodyFont = "'Source Sans 3', system-ui, sans-serif";
const headingFont = "'Playfair Display', Georgia, serif";

const pageStyle: React.CSSProperties = {
  fontFamily: bodyFont,
  backgroundColor: '#0f0f14',
  color: '#e2e8f0',
};

const fonts = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+3:wght@400;500;600&display=swap');
`;

const proseStyles = `
  .kb-prose {
    color: #cbd5e1;
    font-size: 17px;
    line-height: 1.8;
    font-family: 'Source Sans 3', system-ui, sans-serif;
  }
  .kb-prose h1, .kb-prose h2, .kb-prose h3, .kb-prose h4 {
    font-family: 'Playfair Display', Georgia, serif;
    color: #f1f5f9;
    font-weight: 700;
    margin-top: 2em;
    margin-bottom: 0.6em;
    line-height: 1.25;
  }
  .kb-prose h2 { font-size: 1.6em; }
  .kb-prose h3 { font-size: 1.3em; }
  .kb-prose h4 { font-size: 1.1em; font-family: 'Source Sans 3', system-ui, sans-serif; font-weight: 600; color: #e2e8f0; }
  .kb-prose p { margin-bottom: 1.25em; color: #cbd5e1; }
  .kb-prose ul, .kb-prose ol { padding-left: 1.5em; margin-bottom: 1.25em; }
  .kb-prose li { margin-bottom: 0.4em; color: #cbd5e1; }
  .kb-prose strong { color: #f1f5f9; font-weight: 600; }
  .kb-prose em { color: #94a3b8; }
  .kb-prose a { color: #a78bfa; text-decoration: underline; text-underline-offset: 3px; }
  .kb-prose a:hover { color: #c4b5fd; }
  .kb-prose code {
    font-family: 'IBM Plex Mono', 'Fira Code', monospace;
    font-size: 0.875em;
    background: rgba(124,58,237,0.15);
    color: #c4b5fd;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    border: 1px solid rgba(124,58,237,0.25);
  }
  .kb-prose pre {
    background: #1a1a2e;
    color: #e2e8f0;
    padding: 1.25em 1.5em;
    border-radius: 10px;
    overflow-x: auto;
    margin-bottom: 1.5em;
    font-size: 0.875em;
    line-height: 1.6;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .kb-prose pre code {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .kb-prose blockquote {
    border-left: 3px solid #7c3aed;
    padding-left: 1.25em;
    margin-left: 0;
    color: #94a3b8;
    font-style: italic;
    margin-bottom: 1.25em;
    background: rgba(124,58,237,0.06);
    padding-top: 0.5em;
    padding-bottom: 0.5em;
    border-radius: 0 6px 6px 0;
  }
  .kb-prose hr {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.08);
    margin: 2.5em 0;
  }
  .kb-prose table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5em;
    font-size: 0.9em;
  }
  .kb-prose th {
    background: rgba(124,58,237,0.12);
    font-weight: 600;
    color: #e2e8f0;
    text-align: left;
    padding: 0.65em 1em;
    border-bottom: 1px solid rgba(124,58,237,0.3);
  }
  .kb-prose td {
    padding: 0.65em 1em;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    vertical-align: top;
    color: #cbd5e1;
  }
  .kb-prose tr:last-child td { border-bottom: none; }
  .kb-prose img { border-radius: 8px; max-width: 100%; border: 1px solid rgba(255,255,255,0.08); }
`;

export default SharedKBArticle;
