import { useEffect } from 'react';

/** Sätter SEO- och titelmetadata endast medan den publika routen är monterad. */
export function usePublicKBPageMeta(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    const existingRobots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const createdRobots = !existingRobots;
    const robots = existingRobots ?? document.createElement('meta');
    const previousRobotsContent = robots.getAttribute('content');

    if (createdRobots) {
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    document.title = title;
    robots.content = 'noindex, nofollow, noarchive';

    return () => {
      document.title = previousTitle;
      if (createdRobots) robots.remove();
      else if (previousRobotsContent === null) robots.removeAttribute('content');
      else robots.content = previousRobotsContent;
    };
  }, [title]);
}

export const publicKbProseStyles = `
  .public-kb-prose { color: hsl(var(--foreground)); font-size: 1rem; line-height: 1.8; }
  .public-kb-prose h1, .public-kb-prose h2, .public-kb-prose h3, .public-kb-prose h4 { color: hsl(var(--foreground)); font-weight: 700; line-height: 1.25; margin: 2em 0 .65em; }
  .public-kb-prose h2 { font-size: 1.5em; } .public-kb-prose h3 { font-size: 1.25em; }
  .public-kb-prose p, .public-kb-prose ul, .public-kb-prose ol, .public-kb-prose blockquote, .public-kb-prose pre, .public-kb-prose table { margin-bottom: 1.25em; }
  .public-kb-prose ul, .public-kb-prose ol { padding-left: 1.5em; } .public-kb-prose li { margin-bottom: .4em; }
  .public-kb-prose a { color: hsl(var(--primary)); text-decoration: underline; text-underline-offset: 3px; }
  .public-kb-prose code { border: 1px solid hsl(var(--border)); border-radius: .25rem; background: hsl(var(--muted)); color: hsl(var(--primary)); padding: .15em .4em; font-size: .875em; }
  .public-kb-prose pre { overflow-x: auto; border: 1px solid hsl(var(--border)); border-radius: .5rem; background: hsl(var(--muted)); padding: 1rem; }
  .public-kb-prose pre code { border: 0; background: transparent; padding: 0; color: inherit; }
  .public-kb-prose blockquote { border-left: 3px solid hsl(var(--primary)); border-radius: 0 .375rem .375rem 0; background: hsl(var(--primary) / .05); padding: .5rem 0 .5rem 1rem; color: hsl(var(--muted-foreground)); }
  .public-kb-prose img { max-width: 100%; border: 1px solid hsl(var(--border)); border-radius: .5rem; }
  .public-kb-prose table { width: 100%; border-collapse: collapse; } .public-kb-prose th, .public-kb-prose td { border: 1px solid hsl(var(--border)); padding: .65em .8em; text-align: left; vertical-align: top; } .public-kb-prose th { background: hsl(var(--muted)); }
  @media (prefers-reduced-motion: reduce) { .public-kb-prose *, .public-kb-prose *::before, .public-kb-prose *::after { scroll-behavior: auto !important; } }
`;
