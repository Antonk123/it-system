import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Folder, Loader2, AlertCircle, Calendar } from 'lucide-react';
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
        <div style={{ fontFamily: "'Source Sans 3', system-ui, sans-serif" }} className="min-h-dvh bg-[#FAFAF8] flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-[#1a1a2e]/20 border-t-[#1a1a2e] animate-spin" />
            <p className="text-sm text-[#6b7280]" style={{ fontFamily: "'Source Sans 3', system-ui, sans-serif" }}>Laddar artikel…</p>
          </div>
        </div>
      </>
    );
  }

  if (error || !article) {
    return (
      <>
        <style>{fonts}</style>
        <div style={{ fontFamily: "'Source Sans 3', system-ui, sans-serif" }} className="min-h-dvh bg-[#FAFAF8] flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-5">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1a1a2e] mb-1">Sidan hittades inte</h2>
              <p className="text-sm text-[#6b7280] leading-relaxed">{error || 'Länken verkar vara ogiltig.'}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{fonts + proseStyles}</style>

      <div style={{ fontFamily: "'Source Sans 3', system-ui, sans-serif", backgroundColor: '#FAFAF8' }} className="min-h-dvh">

        {/* Top bar */}
        <header className="border-b border-[#e5e5e0] bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-[#1a1a2e] flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-[#1a1a2e] tracking-tight">IT Knowledge Base</span>
            </div>
            {article.category_name && (
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full border"
                style={{
                  backgroundColor: article.category_color ? article.category_color + '14' : '#f3f4f6',
                  borderColor: article.category_color ? article.category_color + '40' : '#e5e7eb',
                  color: article.category_color || '#6b7280',
                }}
              >
                <Folder className="w-3 h-3 inline mr-1 -mt-0.5" />
                {article.category_name}
              </span>
            )}
          </div>
        </header>

        {/* Hero */}
        <div className="bg-white border-b border-[#e5e5e0]">
          <div className="max-w-3xl mx-auto px-6 pt-12 pb-10">
            <h1
              style={{ fontFamily: "'Playfair Display', Georgia, serif", lineHeight: 1.2 }}
              className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold text-[#1a1a2e] mb-5"
            >
              {article.title}
            </h1>
            <div className="flex items-center gap-1.5 text-[13px] text-[#9ca3af]">
              <Calendar className="w-3.5 h-3.5" />
              <span>Uppdaterad {formatDate(article.updated_at)}</span>
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
            <p className="text-[#9ca3af] italic text-sm">Inget innehåll ännu.</p>
          )}
        </main>

        {/* Footer — väcker nyfikenhet */}
        <footer className="border-t border-[#e5e5e0] bg-white mt-8">
          <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-[#1a1a2e] flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1a1a2e] leading-none">IT Knowledge Base</p>
                <p className="text-xs text-[#9ca3af] mt-0.5">Internt supportsystem</p>
              </div>
            </div>
            <p className="text-xs text-[#9ca3af] text-center sm:text-right leading-relaxed max-w-xs">
              Behöver du mer hjälp? Kontakta IT-avdelningen<br />
              för att logga ett ärende i systemet.
            </p>
          </div>
        </footer>

      </div>
    </>
  );
};

const fonts = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+3:wght@400;500;600&display=swap');
`;

const proseStyles = `
  .kb-prose {
    color: #374151;
    font-size: 17px;
    line-height: 1.75;
  }
  .kb-prose h1, .kb-prose h2, .kb-prose h3, .kb-prose h4 {
    font-family: 'Playfair Display', Georgia, serif;
    color: #1a1a2e;
    font-weight: 700;
    margin-top: 2em;
    margin-bottom: 0.6em;
    line-height: 1.25;
  }
  .kb-prose h2 { font-size: 1.6em; }
  .kb-prose h3 { font-size: 1.3em; }
  .kb-prose h4 { font-size: 1.1em; font-family: 'Source Sans 3', system-ui, sans-serif; font-weight: 600; }
  .kb-prose p { margin-bottom: 1.25em; }
  .kb-prose ul, .kb-prose ol { padding-left: 1.5em; margin-bottom: 1.25em; }
  .kb-prose li { margin-bottom: 0.4em; }
  .kb-prose strong { color: #1a1a2e; font-weight: 600; }
  .kb-prose a { color: #4338ca; text-decoration: underline; text-underline-offset: 3px; }
  .kb-prose a:hover { color: #3730a3; }
  .kb-prose code {
    font-family: 'IBM Plex Mono', 'Fira Code', monospace;
    font-size: 0.875em;
    background: #f3f4f6;
    color: #1a1a2e;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
  }
  .kb-prose pre {
    background: #1a1a2e;
    color: #e5e7eb;
    padding: 1.25em 1.5em;
    border-radius: 10px;
    overflow-x: auto;
    margin-bottom: 1.5em;
    font-size: 0.875em;
    line-height: 1.6;
  }
  .kb-prose pre code {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .kb-prose blockquote {
    border-left: 3px solid #4338ca;
    padding-left: 1.25em;
    margin-left: 0;
    color: #6b7280;
    font-style: italic;
    margin-bottom: 1.25em;
  }
  .kb-prose hr {
    border: none;
    border-top: 1px solid #e5e5e0;
    margin: 2.5em 0;
  }
  .kb-prose table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5em;
    font-size: 0.9em;
  }
  .kb-prose th {
    background: #f9fafb;
    font-weight: 600;
    color: #1a1a2e;
    text-align: left;
    padding: 0.65em 1em;
    border-bottom: 2px solid #e5e7eb;
  }
  .kb-prose td {
    padding: 0.65em 1em;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: top;
  }
  .kb-prose tr:last-child td { border-bottom: none; }
`;

export default SharedKBArticle;
