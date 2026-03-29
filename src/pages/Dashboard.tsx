import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ticket, Clock, CheckCircle, Archive, AlertTriangle, ArrowRight, PauseCircle, Plus, X, LayoutList, ChevronUp, ChevronDown } from 'lucide-react';
import { subDays, isSameDay, format, startOfDay } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useDashboardQueues, DashboardQueue } from '@/hooks/useDashboardQueues';
import { useFilterViews } from '@/hooks/useFilterViews';
import { FilterView } from '@/types/filterView';
import { Layout } from '@/components/Layout';
import { KPICard } from '@/components/KPICard';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// QueueCard — individual dashboard queue card
// ---------------------------------------------------------------------------

interface QueueCardProps {
  queue: DashboardQueue;
  filterView: FilterView | undefined;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  onNavigate: () => void;
}

function QueueCard({ queue, filterView, onRemove, onMoveUp, onMoveDown, isFirst, isLast, onNavigate }: QueueCardProps) {
  // Build query params from filterView.filters for the count API call
  const filterParams = useMemo(() => {
    if (!filterView) return null;
    const params = new URLSearchParams();
    params.set('countOnly', 'true');
    // Need at least one param so pagination code path runs
    params.set('page', '1');
    params.set('limit', '1');
    const f = filterView.filters;
    if (f.status?.length) params.set('status', f.status.join(','));
    if (f.priority) params.set('priority', f.priority);
    if (f.category) params.set('category', f.category);
    if (f.tags?.length) params.set('tags', f.tags.join(','));
    if (f.tagMode) params.set('tagMode', f.tagMode);
    if (f.search) params.set('search', f.search);
    if (f.checklist) params.set('checklist', f.checklist);
    if (f.dateFrom) params.set('dateFrom', f.dateFrom);
    if (f.dateTo) params.set('dateTo', f.dateTo);
    if (f.dateField) params.set('dateField', f.dateField);
    return params.toString();
  }, [filterView]);

  const { data } = useQuery({
    queryKey: ['tickets', 'count', queue.filterViewId, filterParams],
    queryFn: () => api.get<{ count: number }>(`/tickets?${filterParams}`),
    enabled: !!filterParams,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // refresh every minute
  });

  if (!filterView) return null; // orphaned queue — filter view was deleted

  const count = (data as { count: number } | null)?.count ?? 0;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors group relative"
      onClick={onNavigate}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {filterView.name}
          </CardTitle>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={isFirst}
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              title="Flytta upp"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={isLast}
              onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
              title="Flytta ner"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              title="Ta bort ko"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{count}</p>
        <p className="text-xs text-muted-foreground mt-1">matchande arenden</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const Dashboard = () => {
  const { tickets } = useTickets({ limit: 1000, status: 'all' });
  const { getUserById } = useUsers();
  const navigate = useNavigate();
  const { queues, addQueue, removeQueue, moveQueue } = useDashboardQueues();
  const { views: allViews } = useFilterViews();
  const [addDialogOpen, setAddDialogOpen] = useState(false);

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
          <h1 className="text-xl font-bold text-foreground">Oversikt</h1>
          <p className="text-muted-foreground mt-1">Oversikt over dina IT-supportarenden</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Oppna arenden"
            value={stats.open}
            icon={<Ticket className="w-5 h-5" />}
            trend={trends.open}
            sparklineData={sparklineData.open}
            onClick={() => navigate('/tickets?status=open')}
            animationDelay={0}
          />
          <KPICard
            label="Pagaende"
            value={stats.inProgress}
            icon={<Clock className="w-5 h-5" />}
            trend={trends.inProgress}
            sparklineData={sparklineData.inProgress}
            onClick={() => navigate('/tickets?status=in-progress')}
            animationDelay={100}
          />
          <KPICard
            label="Vantar"
            value={stats.waiting}
            icon={<PauseCircle className="w-5 h-5" />}
            trend={trends.waiting}
            sparklineData={sparklineData.waiting}
            onClick={() => navigate('/tickets?status=waiting')}
            animationDelay={200}
          />
          <KPICard
            label="Losta"
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
                  {stats.critical} kritisk{stats.critical > 1 ? 'a' : 't'} arende{stats.critical > 1 ? 'n' : ''} kraver uppmarksamhet
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

        {/* Dashboard Queues (replaces aging groups) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <LayoutList className="h-5 w-5" />
              Koer
            </h2>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <Plus className="h-4 w-4" /> Lagg till ko
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Valj filtervy</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {allViews
                    .filter(v => !queues.some(q => q.filterViewId === v.id))
                    .map(view => (
                      <Button
                        key={view.id}
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => { addQueue(view.id); setAddDialogOpen(false); }}
                      >
                        {view.name}
                      </Button>
                    ))}
                  {allViews.filter(v => !queues.some(q => q.filterViewId === v.id)).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Alla filtervyer ar redan tillagda. Skapa nya filtervyer pa arendesidan.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {queues.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-card">
              <LayoutList className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Inga koer tillagda</p>
              <p className="text-sm text-muted-foreground mt-1">
                Lagg till filtervyer som koer for att se antal matchande arenden har.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {queues.map((queue, index) => {
                const filterView = allViews.find(v => v.id === queue.filterViewId);
                return (
                  <QueueCard
                    key={queue.id}
                    queue={queue}
                    filterView={filterView}
                    onRemove={() => removeQueue(queue.id)}
                    onMoveUp={() => moveQueue(queue.id, 'up')}
                    onMoveDown={() => moveQueue(queue.id, 'down')}
                    isFirst={index === 0}
                    isLast={index === queues.length - 1}
                    onNavigate={() => {
                      if (filterView) {
                        const params = new URLSearchParams();
                        const f = filterView.filters;
                        if (f.status?.length) f.status.forEach(s => params.append('status', s));
                        if (f.priority) params.set('priority', f.priority);
                        if (f.category) params.set('category', f.category);
                        if (f.tags?.length) params.set('tags', f.tags.join(','));
                        if (f.search) params.set('search', f.search);
                        navigate(`/tickets?${params.toString()}`);
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
