import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ticket, Clock, CheckCircle, Archive, AlertTriangle, ArrowRight, PauseCircle } from 'lucide-react';
import { subDays, isSameDay, format, startOfDay } from 'date-fns';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { useUpcomingReminders } from '@/hooks/useUpcomingReminders';
import { Layout } from '@/components/Layout';
import { KPICard } from '@/components/KPICard';
import { AgingTicketsPanel } from '@/components/AgingTicketsPanel';
import { RemindersPanel } from '@/components/RemindersPanel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const Dashboard = () => {
  const { tickets } = useTickets({ limit: 1000, status: 'all' });
  const { users, getUserById } = useUsers();
  const navigate = useNavigate();
  const { data: dashboardOverview, isLoading: isOverviewLoading } = useDashboardOverview();
  const { data: upcomingReminders, isLoading: isRemindersLoading } = useUpcomingReminders();

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
      resolved: { ...calculateTrend(stats.resolved, t => t.status === 'resolved'), isPositive: true },
      closed: { ...calculateTrend(stats.closed, t => t.status === 'closed'), isPositive: true },
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

  const criticalTickets = useMemo(() => {
    return tickets
      .filter(t => t.priority === 'critical' && t.status !== 'closed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [tickets]);

  return (
    <Layout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Översikt</h1>
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
            subLabel={
              isOverviewLoading
                ? <Skeleton className="h-3 w-16 mt-1" />
                : dashboardOverview?.todayCounts.created_today
                  ? <span className="text-primary font-semibold">+{dashboardOverview.todayCounts.created_today} idag</span>
                  : <span>+0 idag</span>
            }
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
            subLabel={
              isOverviewLoading
                ? <Skeleton className="h-3 w-16 mt-1" />
                : dashboardOverview?.todayCounts.resolved_today
                  ? <span className="text-primary font-semibold">+{dashboardOverview.todayCounts.resolved_today} idag</span>
                  : <span>+0 idag</span>
            }
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
            subLabel={
              isOverviewLoading
                ? <Skeleton className="h-3 w-16 mt-1" />
                : dashboardOverview?.todayCounts.closed_today
                  ? <span className="text-primary font-semibold">+{dashboardOverview.todayCounts.closed_today} idag</span>
                  : <span>+0 idag</span>
            }
          />
        </div>

        {/* Dashboard Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="animate-fade-in" style={{ animationDelay: '0ms' }}>
            <AgingTicketsPanel
              tickets={dashboardOverview?.agingTickets}
              isLoading={isOverviewLoading}
            />
          </div>
          <div className="animate-fade-in" style={{ animationDelay: '100ms' }}>
            <RemindersPanel
              reminders={upcomingReminders}
              isLoading={isRemindersLoading}
            />
          </div>
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
      </div>
    </Layout>
  );
};

export default Dashboard;
