import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Clock, CheckCircle, Archive, AlertTriangle, ArrowRight, PauseCircle } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { Layout } from '@/components/Layout';
import { StatsCard } from '@/components/StatsCard';
import { TicketCard } from '@/components/TicketCard';
import { Button } from '@/components/ui/button';

const Dashboard = () => {
  const { tickets } = useTickets();
  const { users, getUserById } = useUsers();

  const stats = useMemo(() => {
    const open = tickets.filter(t => t.status === 'open').length;
    const inProgress = tickets.filter(t => t.status === 'in-progress').length;
    const waiting = tickets.filter(t => t.status === 'waiting').length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;
    const closed = tickets.filter(t => t.status === 'closed').length;
    const critical = tickets.filter(t => t.priority === 'critical' && t.status !== 'closed').length;
    
    return { open, inProgress, waiting, resolved, closed, critical, total: tickets.length };
  }, [tickets]);

  const recentTickets = useMemo(() => {
    return tickets
      .filter(t => t.status !== 'closed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5);
  }, [tickets]);

  const criticalTickets = useMemo(() => {
    return tickets
      .filter(t => t.priority === 'critical' && t.status !== 'closed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [tickets]);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Översikt</h1>
          <p className="text-muted-foreground mt-1">Översikt över dina IT-supportärenden</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Öppna ärenden"
            value={stats.open}
            icon={<Ticket className="w-6 h-6" />}
            to="/tickets?status=open"
          />
          <StatsCard
            title="Pågående"
            value={stats.inProgress}
            icon={<Clock className="w-6 h-6" />}
            to="/tickets?status=in-progress"
          />
          <StatsCard
            title="Väntar"
            value={stats.waiting}
            icon={<PauseCircle className="w-6 h-6" />}
            to="/tickets?status=waiting"
          />
          <StatsCard
            title="Lösta"
            value={stats.resolved}
            icon={<CheckCircle className="w-6 h-6" />}
            to="/tickets?status=resolved"
          />
          <StatsCard
            title="Arkiverade"
            value={stats.closed}
            icon={<Archive className="w-6 h-6" />}
            to="/archive"
          />
        </div>

        {/* Critical Tickets Alert */}
        {stats.critical > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <div className="flex-1">
                <p className="font-medium text-destructive">
                  {stats.critical} kritisk{stats.critical > 1 ? 'a' : 't'} ärende{stats.critical > 1 ? 'n' : ''} kräver uppmärksamhet
                </p>
              </div>
              <Link to="/tickets?priority=critical">
                <Button variant="outline" size="sm" className="gap-1">
                  Visa alla <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Recent Tickets */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Senaste ärenden</h2>
            <Link to="/tickets">
              <Button variant="ghost" size="sm" className="gap-1">
                Visa alla <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
          
          {recentTickets.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-card">
              <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Inga aktiva ärenden</p>
              <Link to="/tickets/new">
                <Button className="mt-4">Skapa ditt första ärende</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentTickets.map(ticket => (
                <TicketCard 
                  key={ticket.id} 
                  ticket={ticket} 
                  user={getUserById(ticket.requesterId)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
