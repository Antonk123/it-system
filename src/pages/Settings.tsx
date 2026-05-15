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
          <TabsList className={`w-full grid ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <TabsTrigger value="general">Allmänt</TabsTrigger>
            <TabsTrigger value="tickets">Ärenden</TabsTrigger>
            <TabsTrigger value="integrations">Integrationer</TabsTrigger>
            {isAdmin && <TabsTrigger value="admin">Administration</TabsTrigger>}
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
