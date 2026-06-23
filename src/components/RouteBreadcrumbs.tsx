import { Link, useLocation } from 'react-router-dom';
import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

const sectionLabels: Record<string, string> = {
  tickets: 'Alla ärenden',
  kb: 'Kunskapsbas',
  companies: 'Företag',
  recurring: 'Återkommande',
  invoices: 'Fakturering',
  archive: 'Arkiv',
  users: 'Kontakter',
  reports: 'Rapporter',
  settings: 'Inställningar',
};

function buildCrumbs(pathname: string): { label: string; href?: string }[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return []; // root "/" — Dashboard har egen h1

  const section = segments[0];
  const sectionLabel = sectionLabels[section];
  if (!sectionLabel) return [];

  // Top-level (e.g. /tickets) — visa sektionsnamnet som current page
  if (segments.length === 1) {
    return [{ label: sectionLabel }];
  }

  const crumbs: { label: string; href?: string }[] = [
    { label: sectionLabel, href: `/${section}` },
  ];

  if (segments[1] === 'new') {
    crumbs.push({ label: section === 'kb' ? 'Ny artikel' : 'Nytt ärende' });
    return crumbs;
  }

  const id = segments[1];
  if (/^\d+$/.test(id)) {
    const idLabel = section === 'tickets' ? `#${id}` : section === 'kb' ? `Artikel #${id}` : `#${id}`;
    if (segments[2] === 'edit') {
      crumbs.push({ label: idLabel, href: `/${section}/${id}` });
      crumbs.push({ label: 'Redigera' });
    } else {
      crumbs.push({ label: idLabel });
    }
  }

  return crumbs;
}

export function RouteBreadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

  if (crumbs.length === 0) return null;

  return (
    // Breadcrumb renderar <nav> (svensk etikett), BreadcrumbList <ol>,
    // BreadcrumbItem <li> och BreadcrumbPage sätter aria-current="page" på
    // den sista (aktuella) noden.
    <Breadcrumb aria-label="Brödsmulor">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href ? (
                <BreadcrumbLink asChild>
                  <Link to={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
