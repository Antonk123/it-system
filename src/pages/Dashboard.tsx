import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ticket, Clock, CheckCircle, Archive, AlertTriangle, ArrowRight, PauseCircle } from 'lucide-react';
import { subDays, isSameDay, format, startOfDay, differenceInDays, formatDistanceToNow } from 'date-fns';
import { sv } from 'date-fns/locale';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { Layout } from '@/components/Layout';
import { KPICard } from '@/components/KPICard';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const Dashboard = () => {
  const { tickets } = useTickets();
  const { users, getUserById } = useUsers();
  const navigate = useNavigate();

  // Helper to get priority color
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const stats = useMemo(() => {
    const open = tickets.filter(t => t.status === 'open').length;
    const inProgress = tickets.filter(t => t.status === 'in-progress').length;
    const waiting = tickets.filter(t => t.status === 'waiting').length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;
    const closed = tickets.filter(t => t.status === 'closed').length;
    const critical = tickets.filter(t => t.priority === 'critical' && t.status !== 'closed').length;

    return { open, inProgress, waiting, resolved, closed, critical, total: tickets.length };
  }, [tickets]);

  // Calculate trends (compare to last 7 days)
  const trends = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7);

    const calculateTrend = (currentCount: number, filterFn: (t: any) => boolean) => {
      const oldCount = tickets.filter(t =>
        t.createdAt < sevenDaysAgo && filterFn(t)
      ).length;

      if (oldCount === 0) return { value: 0, direction: 'up' as const, isPositive: true };

      const change = ((currentCount - oldCount) / oldCount) * 100;
      return {
        value: Math.abs(Math.round(change)),
        direction: change >= 0 ? ('up' as const) : ('down' as const),
        isPositive: change < 0, // Less is better for open/waiting
      };
    };

    return {
      open: calculateTrend(stats.open, t => t.status === 'open'),
      inProgress: calculateTrend(stats.inProgress, t => t.status === 'in-progress'),
      waiting: calculateTrend(stats.waiting, t => t.status === 'waiting'),
      resolved: { ...calculateTrend(stats.resolved, t => t.status === 'resolved'), isPositive: true }, // More is better
      closed: { ...calculateTrend(stats.closed, t => t.status === 'closed'), isPositive: true }, // More is better
    };
  }, [tickets, stats]);

  // Calculate sparkline data (last 7 days)
  const sparklineData = useMemo(() => {
    const generateSparkline = (filterFn: (t: any) => boolean) => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = startOfDay(subDays(new Date(), i));
        const count = tickets.filter(t =>
          isSameDay(t.createdAt, date) && filterFn(t)
        ).length;
        days.push({ month: format(date, 'EEE'), value: count });
      }
      return days;
    };

    return {
      open: generateSparkline(t => t.status === 'open'),
      inProgress: generateSparkline(t => t.status === 'in-progress'),
      waiting: generateSparkline(t => t.status === 'waiting'),
      resolved: generateSparkline(t => t.status === 'resolved'),
      closed: generateSparkline(t => t.status === 'closed'),
    };
  }, [tickets]);

  const recentTickets = useMemo(() => {
    return tickets
      .filter(t => t.status !== 'closed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 9);
  }, [tickets]);

  const criticalTickets = useMemo(() => {
    return tickets
      .filter(t => t.priority === 'critical' && t.status !== 'closed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [tickets]);

  // Calculate aging tickets (tickets older than 7 days that aren't closed/resolved)
  const agingTickets = useMemo(() => {
    const now = new Date();
    return tickets
      .filter(t => t.status !== 'closed' && t.status !== 'resolved')
      .map(t => ({
        ...t,
        daysOld: differenceInDays(now, t.createdAt),
      }))
      .filter(t => t.daysOld > 7)
      .sort((a, b) => b.daysOld - a.daysOld);
  }, [tickets]);

  // Group aging tickets by severity
  const agingGroups = useMemo(() => {
    return {
      critical: agingTickets.filter(t => t.daysOld > 30),
      warning: agingTickets.filter(t => t.daysOld > 14 && t.daysOld <= 30),
      attention: agingTickets.filter(t => t.daysOld > 7 && t.daysOld <= 14),
    };
  }, [agingTickets]);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Översikt</h1>
          <p className="text-muted-foreground mt-1">Översikt över dina IT-supportärenden</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Öppna ärenden"
            value={stats.open}
            icon={<Ticket className="w-5 h-5" />}
            trend={trends.open}
            sparklineData={sparklineData.open}
            onClick={() => navigate('/tickets?status=open')}
            animationDelay={0}
          />
          <KPICard
            label="Pågående"
            value={stats.inProgress}
            icon={<Clock className="w-5 h-5" />}
            trend={trends.inProgress}
            sparklineData={sparklineData.inProgress}
            onClick={() => navigate('/tickets?status=in-progress')}
            animationDelay={100}
          />
          <KPICard
            label="Väntar"
            value={stats.waiting}
            icon={<PauseCircle className="w-5 h-5" />}
            trend={trends.waiting}
            sparklineData={sparklineData.waiting}
            onClick={() => navigate('/tickets?status=waiting')}
            animationDelay={200}
          />
          <KPICard
            label="Lösta"
            value={stats.resolved}
            icon={<CheckCircle className="w-5 h-5" />}
            trend={trends.resolved}
            sparklineData={sparklineData.resolved}
            onClick={() => navigate('/tickets?status=resolved')}
            animationDelay={300}
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KPICard
            label="Arkiverade"
            value={stats.closed}
            icon={<Archive className="w-5 h-5" />}
            trend={trends.closed}
            sparklineData={sparklineData.closed}
            onClick={() => navigate('/archive')}
            animationDelay={0}
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

        {/* Combined Tickets Section */}
        <div>
          {recentTickets.length === 0 && agingTickets.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-card">
              <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Inga aktiva ärenden</p>
              <Link to="/tickets/new">
                <Button className="mt-4">Skapa ditt första ärende</Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {/* Aging tickets cards */}
              {agingGroups.critical.length > 0 && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-destructive">
                      Kritiska ({agingGroups.critical.length})
                    </CardTitle>
                    <CardDescription className="text-xs">Över 30 dagar gamla</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {agingGroups.critical.slice(0, 3).map(ticket => (
                      <Link key={ticket.id} to={`/tickets/${ticket.id}`}>
                        <div className="py-1.5 px-2.5 border border-border rounded hover:bg-muted/50 transition-colors">
                          <p className="font-medium text-sm line-clamp-1">{ticket.title}</p>
                          <p className="text-xs text-muted-foreground">{ticket.daysOld} dagar gammal</p>
                        </div>
                      </Link>
                    ))}
                    {agingGroups.critical.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{agingGroups.critical.length - 3} fler
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {agingGroups.warning.length > 0 && (
                <Card className="border-yellow-500/50 bg-yellow-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-yellow-700 dark:text-yellow-500">
                      Kräver uppmärksamhet ({agingGroups.warning.length})
                    </CardTitle>
                    <CardDescription className="text-xs">14-30 dagar gamla</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {agingGroups.warning.slice(0, 3).map(ticket => (
                      <Link key={ticket.id} to={`/tickets/${ticket.id}`}>
                        <div className="py-1.5 px-2.5 border border-border rounded hover:bg-muted/50 transition-colors">
                          <p className="font-medium text-sm line-clamp-1">{ticket.title}</p>
                          <p className="text-xs text-muted-foreground">{ticket.daysOld} dagar gammal</p>
                        </div>
                      </Link>
                    ))}
                    {agingGroups.warning.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{agingGroups.warning.length - 3} fler
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {agingGroups.attention.length > 0 && (
                <Card className="border-orange-500/50 bg-orange-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-orange-700 dark:text-orange-500">
                      Uppmärksamhet ({agingGroups.attention.length})
                    </CardTitle>
                    <CardDescription className="text-xs">7-14 dagar gamla</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {agingGroups.attention.slice(0, 3).map(ticket => (
                      <Link key={ticket.id} to={`/tickets/${ticket.id}`}>
                        <div className="py-1.5 px-2.5 border border-border rounded hover:bg-muted/50 transition-colors">
                          <p className="font-medium text-sm line-clamp-1">{ticket.title}</p>
                          <p className="text-xs text-muted-foreground">{ticket.daysOld} dagar gammal</p>
                        </div>
                      </Link>
                    ))}
                    {agingGroups.attention.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{agingGroups.attention.length - 3} fler
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Recent tickets card */}
              {recentTickets.length > 0 && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-primary">
                      Senaste ärenden ({recentTickets.length})
                    </CardTitle>
                    <CardDescription className="text-xs">Aktiva ärenden</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {recentTickets.slice(0, 3).map(ticket => {
                      const user = getUserById(ticket.requesterId);
                      return (
                        <Link key={ticket.id} to={`/tickets/${ticket.id}`}>
                          <div className="py-1.5 px-2.5 border border-border rounded hover:bg-muted/50 transition-colors">
                            <p className="font-medium text-sm line-clamp-1">{ticket.title}</p>
                            <p className="text-xs text-muted-foreground">{formatDistanceToNow(ticket.createdAt, { addSuffix: true, locale: sv })}</p>
                          </div>
                        </Link>
                      );
                    })}
                    {recentTickets.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{recentTickets.length - 3} fler
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
