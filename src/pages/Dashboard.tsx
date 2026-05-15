import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Ticket, Clock, CheckCircle, AlertTriangle, ArrowRight, PauseCircle } from 'lucide-react';
import { subDays, isSameDay, format, startOfDay } from 'date-fns';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { useUpcomingReminders } from '@/hooks/useUpcomingReminders';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useStatusCounts } from '@/hooks/useStatusCounts';
import { Layout } from '@/components/Layout';
import { KPICard } from '@/components/KPICard';
import { AgingTicketsPanel } from '@/components/AgingTicketsPanel';
import { RemindersPanel } from '@/components/RemindersPanel';
import { StatusFlowPanel } from '@/components/StatusFlowPanel';
import { ActivityFeedPanel } from '@/components/ActivityFeedPanel';
import { TicketQueueTable } from '@/components/TicketQueueTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const kpiContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const kpiItem = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

const sectionFade = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// ---------------------------------------------------------------------------
// Greeting helper
// ---------------------------------------------------------------------------
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'God natt';
  if (hour < 10) return 'God morgon';
  if (hour < 13) return 'God förmiddag';
  if (hour < 18) return 'God eftermiddag';
  return 'God kväll';
}

function getGreetingName(email: string | undefined): string {
  if (!email) return '';
  const prefix = email.split('@')[0];
  const firstSegment = prefix.split(/[.\-_]/)[0];
  if (!firstSegment) return '';
  return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const Dashboard = () => {
  const { tickets } = useTickets({ limit: 1000, status: 'all' });
  const { users, getUserById } = useUsers();
  const { user } = useAuth();
  const greetingName = getGreetingName(user?.email);
  const navigate = useNavigate();
  const { data: dashboardOverview, isLoading: isOverviewLoading } = useDashboardOverview();
  const { data: upcomingReminders, isLoading: isRemindersLoading } = useUpcomingReminders();
  const { data: activityEvents, isLoading: isActivityLoading } = useActivityFeed(15);
  const { data: statusCounts, isLoading: isStatusLoading } = useStatusCounts();

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
    };
  }, [tickets]);

  const getUserName = (id: string) => {
    const user = getUserById(id);
    return user?.name || user?.email;
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Page greeting */}
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }}
          animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-2xl md:text-[30px] font-bold tracking-tight text-foreground">
            {getGreeting()}
            {greetingName && (
              <>, <span className="font-serif italic font-medium text-[hsl(var(--accent))]">{greetingName}</span></>
            )}
            .
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Du har{' '}
            <span className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded text-foreground">{stats.open}</span>
            {' '}öppna ärenden och{' '}
            <span className="font-mono text-xs bg-muted/50 px-1.5 py-0.5 rounded text-foreground">{stats.inProgress}</span>
            {' '}pågående.
            {isOverviewLoading
              ? ''
              : dashboardOverview?.todayCounts.created_today
                ? ` +${dashboardOverview.todayCounts.created_today} nya idag.`
                : ''
            }
          </p>
        </motion.div>

        {/* KPI Grid */}
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          variants={kpiContainer}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate={prefersReducedMotion ? false : 'visible'}
        >
          <motion.div variants={kpiItem}>
            <KPICard
              label="Öppna ärenden"
              value={stats.open}
              icon={<Ticket className="w-5 h-5" />}
              trend={trends.open}
              sparklineData={sparklineData.open}
              onClick={() => navigate('/tickets?status=open')}
              subLabel={
                isOverviewLoading
                  ? <Skeleton className="h-3 w-16 mt-1" />
                  : dashboardOverview?.todayCounts.created_today
                    ? <span className="text-primary font-semibold">+{dashboardOverview.todayCounts.created_today} idag</span>
                    : <span>+0 idag</span>
              }
            />
          </motion.div>
          <motion.div variants={kpiItem}>
            <KPICard
              label="Pågående"
              value={stats.inProgress}
              icon={<Clock className="w-5 h-5" />}
              trend={trends.inProgress}
              sparklineData={sparklineData.inProgress}
              onClick={() => navigate('/tickets?status=in-progress')}
            />
          </motion.div>
          <motion.div variants={kpiItem}>
            <KPICard
              label="Väntar"
              value={stats.waiting}
              icon={<PauseCircle className="w-5 h-5" />}
              trend={trends.waiting}
              sparklineData={sparklineData.waiting}
              onClick={() => navigate('/tickets?status=waiting')}
            />
          </motion.div>
          <motion.div variants={kpiItem}>
            <KPICard
              label="Lösta"
              value={stats.resolved}
              icon={<CheckCircle className="w-5 h-5" />}
              trend={trends.resolved}
              sparklineData={sparklineData.resolved}
              onClick={() => navigate('/tickets?status=resolved')}
              subLabel={
                isOverviewLoading
                  ? <Skeleton className="h-3 w-16 mt-1" />
                  : dashboardOverview?.todayCounts.resolved_today
                    ? <span className="text-primary font-semibold">+{dashboardOverview.todayCounts.resolved_today} idag</span>
                    : <span>+0 idag</span>
              }
            />
          </motion.div>
        </motion.div>

        {/* Two-column layout: Ticket queue + Right sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5">
          {/* Left: Ticket queue */}
          <motion.div
            className="space-y-5"
            variants={sectionFade}
            initial={prefersReducedMotion ? false : 'hidden'}
            animate={prefersReducedMotion ? false : 'visible'}
            transition={{ delay: 0.15 }}
          >
            <TicketQueueTable
              tickets={tickets}
              isLoading={tickets.length === 0 && isOverviewLoading}
              getUserName={getUserName}
            />

            {/* Aging + Reminders below the queue */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AgingTicketsPanel
                tickets={dashboardOverview?.agingTickets}
                isLoading={isOverviewLoading}
              />
              <RemindersPanel
                reminders={upcomingReminders}
                isLoading={isRemindersLoading}
              />
            </div>
          </motion.div>

          {/* Right column: Status flow + Activity */}
          <motion.div
            className="space-y-5"
            variants={sectionFade}
            initial={prefersReducedMotion ? false : 'hidden'}
            animate={prefersReducedMotion ? false : 'visible'}
            transition={{ delay: 0.25 }}
          >
            <StatusFlowPanel
              counts={statusCounts}
              isLoading={isStatusLoading}
            />
            <ActivityFeedPanel
              events={activityEvents}
              isLoading={isActivityLoading}
            />
          </motion.div>
        </div>

        {/* Critical Tickets Alert */}
        {stats.critical > 0 && (
          <motion.div
            className="bg-destructive/10 border border-destructive/30 rounded-lg p-4"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98 }}
            animate={prefersReducedMotion ? false : { opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
          >
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
          </motion.div>
        )}
      </div>
    </Layout>
  );
};

export default Dashboard;
