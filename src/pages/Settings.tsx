import { Layout } from '@/components/Layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import GeneralTab from './settings/GeneralTab';
import TicketsTab from './settings/TicketsTab';
import IntegrationsTab from './settings/IntegrationsTab';
import AdminTab from './settings/AdminTab';

const Settings = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <Layout>
      <div className="max-w-2xl space-y-5">
        <h1 className="text-xl font-bold">Inställningar</h1>
        <Tabs defaultValue="general">
          {/*
            Mobile: horizontal scroll keeps every tab tappable at 360px even with
            longer labels ("Integrationer"/"Administration"). Desktop: even grid.
            Dynamic md:grid-cols-N must be a full class string so Tailwind picks it up.
          */}
          <TabsList
            className={`w-full h-auto flex overflow-x-auto whitespace-nowrap md:grid ${isAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}
          >
            <TabsTrigger value="general" className="shrink-0 md:shrink">Allmänt</TabsTrigger>
            <TabsTrigger value="tickets" className="shrink-0 md:shrink">Ärenden</TabsTrigger>
            <TabsTrigger value="integrations" className="shrink-0 md:shrink">Integrationer</TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="admin" className="shrink-0 md:shrink">
                Administration
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="general" className="space-y-5">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="tickets" className="space-y-5">
            <TicketsTab />
          </TabsContent>
          <TabsContent value="integrations" className="space-y-5">
            <IntegrationsTab />
          </TabsContent>
          {isAdmin && (
            <TabsContent value="admin" className="space-y-5">
              <AdminTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </Layout>
  );
};

export default Settings;
