import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Ticket, Clock, CheckCircle, AlertTriangle, ArrowRight, PauseCircle, Sparkles, RefreshCw } from 'lucide-react';
import { useActiveQueue } from '@/hooks/useActiveQueue';
import { useUsers } from '@/hooks/useUsers';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { useUpcomingReminders } from '@/hooks/useUpcomingReminders';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useStatusCounts } from '@/hooks/useStatusCounts';
import { useDeflectionStats } from '@/hooks/useDeflectionStats';
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
  // Smal fetch: bara aktiva ärenden, sorterade på priority, max 30 — driver TicketQueueTable
  const { data: activeQueue, isLoading: isQueueLoading, isError: isQueueError, refetch: refetchQueue } = useActiveQueue(30);
  const { getUserById } = useUsers();
  const { user } = useAuth();
  const greetingName = getGreetingName(user?.email);
  const navigate = useNavigate();
  const { data: dashboardOverview, isLoading: isOverviewLoading, isError: isOverviewError, refetch: refetchOverview } = useDashboardOverview();
  const { data: upcomingReminders, isLoading: isRemindersLoading, isError: isRemindersError, refetch: refetchReminders } = useUpcomingReminders();
  const { data: activityEvents, isLoading: isActivityLoading, isError: isActivityError, refetch: refetchActivity } = useActivityFeed(15);
  const { data: statusCounts, isLoading: isStatusLoading, isError: isStatusError, refetch: refetchStatus } = useStatusCounts();
  const { data: deflectionStats, isLoading: isDeflectionLoading, isError: isDeflectionError, refetch: refetchDeflection } = useDeflectionStats();

  const hasError = isQueueError || isOverviewError || isRemindersError || isActivityError || isStatusError || isDeflectionError;

  const handleRetryAll = () => {
    refetchQueue();
    refetchOverview();
    refetchReminders();
    refetchActivity();
    refetchStatus();
    refetchDeflection();
  };

  const stats = useMemo(() => {
    const open = statusCounts?.open ?? 0;
    const inProgress = statusCounts?.['in-progress'] ?? 0;
    const waiting = statusCounts?.waiting ?? 0;
    const resolved = statusCounts?.resolved ?? 0;
    const closed = statusCounts?.closed ?? 0;
    const critical = dashboardOverview?.criticalCount ?? 0;
    return { open, inProgress, waiting, resolved, closed, critical, total: open + inProgress + waiting + resolved + closed };
  }, [statusCounts, dashboardOverview]);

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

        {/* Fel-banner — visas diskret om en eller flera queries failar */}
        {hasError && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-destructive/10 border border-destructive/25 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">Kunde inte hämta all data — siffror kan vara ofullständiga.</span>
            <button
              onClick={handleRetryAll}
              className="flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity"
              aria-label="Försök igen"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Försök igen
            </button>
          </div>
        )}

        {/* KPI Grid */}
        <motion.div
          className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4"
          variants={kpiContainer}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate={prefersReducedMotion ? false : 'visible'}
        >
          <motion.div variants={kpiItem}>
            <KPICard
              label="Öppna ärenden"
              value={stats.open}
              icon={<Ticket className="w-5 h-5" />}
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
              onClick={() => navigate('/tickets?status=in-progress')}
            />
          </motion.div>
          <motion.div variants={kpiItem}>
            <KPICard
              label="Väntar"
              value={stats.waiting}
              icon={<PauseCircle className="w-5 h-5" />}
              onClick={() => navigate('/tickets?status=waiting')}
            />
          </motion.div>
          <motion.div variants={kpiItem}>
            <KPICard
              label="Lösta"
              value={stats.resolved}
              icon={<CheckCircle className="w-5 h-5" />}
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
          <motion.div variants={kpiItem}>
            <KPICard
              label="AI-deflection"
              value={deflectionStats?.deflectionRate ?? 0}
              valueSuffix="%"
              icon={<Sparkles className="w-5 h-5" />}
              onClick={() => navigate('/reports')}
              subLabel={
                isDeflectionLoading
                  ? <Skeleton className="h-3 w-20 mt-1" />
                  : deflectionStats && deflectionStats.total > 0
                    ? <span className="text-muted-foreground">{deflectionStats.solved} löst / {deflectionStats.total} (30d)</span>
                    : <span className="text-muted-foreground">Inga 30d</span>
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
              tickets={activeQueue ?? []}
              isLoading={isQueueLoading}
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
