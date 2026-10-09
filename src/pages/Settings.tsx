import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { Building2, ArrowRight, Network, ExternalLink, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';

const GeneralTab = lazy(() => import('./settings/GeneralTab'));
const TicketsTab = lazy(() => import('./settings/TicketsTab'));
const IntegrationsTab = lazy(() => import('./settings/IntegrationsTab'));
const AdminTab = lazy(() => import('./settings/AdminTab'));

const TabFallback = () => (
  <div className="flex justify-center py-8" role="status">
    <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    <span className="sr-only">Laddar…</span>
  </div>
);

const Settings = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">Inställningar</h1>
      <Tabs defaultValue="general">
        {/*
          Mobile: horizontal scroll keeps every tab tappable at 360px even with
          longer labels ("Administration"). Desktop: even grid.
          Dynamic md:grid-cols-N must be a full class string so Tailwind picks it up.
        */}
        <TabsList
          className={`w-full h-auto flex overflow-x-auto whitespace-nowrap md:grid ${isAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}
        >
          <TabsTrigger value="general" className="shrink-0 md:shrink">Allmänt</TabsTrigger>
          <TabsTrigger value="tickets" className="shrink-0 md:shrink">Ärenden</TabsTrigger>
          <TabsTrigger value="integrations" className="shrink-0 md:shrink">E-post</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="shrink-0 md:shrink">
              Administration
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="general" className="space-y-5">
          <Suspense fallback={<TabFallback />}>
            <GeneralTab />
          </Suspense>
          <Link to="/companies" className="flex min-h-14 items-center gap-3 rounded-lg border p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Building2 className="h-5 w-5" aria-hidden="true" />
            <span className="flex-1"><span className="block font-medium">Företag</span><span className="text-sm text-muted-foreground">Hantera företag och kopplingar till beställare.</span></span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </TabsContent>
        <TabsContent value="tickets" className="space-y-5">
          <Suspense fallback={<TabFallback />}>
            <TicketsTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="integrations" className="space-y-5">
          <Suspense fallback={<TabFallback />}>
            <IntegrationsTab section={isAdmin ? "email" : "all"} />
          </Suspense>
        </TabsContent>
        {isAdmin && (
          <TabsContent value="admin" className="space-y-5">
            <Suspense fallback={<TabFallback />}>
              <AdminTab />
              <IntegrationsTab section="technical" />
            </Suspense>
            <a href="/architecture-map" target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 rounded-lg border p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Network className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="flex-1"><span className="block font-medium">Arkitekturkarta</span><span className="text-sm text-muted-foreground">Utforska systemets delar, beroenden och analyser. Öppnas i en ny flik.</span></span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default Settings;
