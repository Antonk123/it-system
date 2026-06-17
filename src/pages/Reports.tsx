import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMode } from '@/hooks/useMode';
import { differenceInDays } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, ComposedChart, Line } from 'recharts';
import { Layout } from '@/components/Layout';
import { useReportsSummary } from '@/hooks/useReportsSummary';
import { useUsers } from '@/hooks/useUsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, RequesterAnalyticsRow } from '@/lib/api';
import { mapTicketRow } from '@/lib/mapTicket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { KPICard } from '@/components/KPICard';
import { StatusFlowChart } from '@/components/StatusFlowChart';
import { TagAnalytics } from '@/components/TagAnalytics';
import { TimeSummaryTab } from '@/components/TimeSummaryTab';
import { KPIDetailDialog } from '@/components/KPIDetailDialog';
import { toast } from 'sonner';
import { BarChart3, PieChart as PieChartIcon, Calendar, Ticket, Clock, CheckCircle, AlertTriangle, Users, Scale, Download, Printer } from 'lucide-react';

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

// Cohesive theme-based color scheme for Status pie chart
const STATUS_COLORS: Record<string, string> = {
  open: 'hsl(var(--chart-1))',      // Blue
  'in-progress': 'hsl(var(--chart-2))',   // Teal/Green
  waiting: 'hsl(var(--chart-3))',         // Purple
  resolved: 'hsl(var(--chart-4))',        // Orange
  closed: 'hsl(var(--muted-foreground))', // Gray for closed
};

// Same colors but different order for visual distinction in Requester Analytics
const REQUESTER_STATUS_COLORS: Record<string, string> = {
  open: 'hsl(var(--chart-2))',            // Different from pie chart
  'in-progress': 'hsl(var(--chart-4))',
  waiting: 'hsl(var(--chart-1))',
  resolved: 'hsl(var(--chart-3))',
  closed: 'hsl(var(--muted-foreground))', // Same gray for consistency
};

const MONTH_NAMES = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
];

const statusLabels: Record<string, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const RequesterTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;

  const requester = payload[0].payload as RequesterAnalyticsRow;

  return (
    <div className="bg-popover text-popover-foreground px-4 py-3 rounded-lg shadow-lg border max-w-xs backdrop-blur-xs">
      {/* Header with gradient accent */}
      <div className="mb-3 pb-2 border-b relative">
        <p className="font-semibold font-serif text-base bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          {requester.name}
        </p>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-primary/50 via-accent/50 to-transparent" />
      </div>

      {/* Status breakdown */}
      <div className="space-y-1.5 text-sm mb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
          Statusfördelning
        </p>
        {Object.entries(requester.statusBreakdown).map(([status, count]) => {
          if (count === 0) return null;
          return (
            <div key={status} className="flex items-center justify-between gap-3 group">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm transition-all group-hover:scale-110"
                  style={{
                    backgroundColor: REQUESTER_STATUS_COLORS[status as keyof typeof REQUESTER_STATUS_COLORS],
                    boxShadow: `0 0 8px ${REQUESTER_STATUS_COLORS[status as keyof typeof REQUESTER_STATUS_COLORS]}40`
                  }}
                />
                <span className="capitalize">
                  {statusLabels[status] || status}
                </span>
              </div>
              <span className="font-mono font-semibold text-primary/80">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Performance metrics */}
      <div className="space-y-1 text-sm pt-2 border-t">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avslutningsgrad:</span>
          <span className="font-mono font-semibold">
            {requester.completionRate.toFixed(0)}%
          </span>
        </div>
        {requester.avgResolutionTime > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Snitt upplösningstid:</span>
            <span className="font-mono font-semibold">
              {requester.avgResolutionTime.toFixed(1)}d
            </span>
          </div>
        )}
        {requester.agingTickets > 0 && (
          <div className="flex justify-between text-destructive">
            <span>Gamla ärenden:</span>
            <span className="font-mono font-semibold">
              {requester.agingTickets}
            </span>
          </div>
        )}
      </div>

      {/* Top categories (if available) */}
      {requester.topCategories.length > 0 && (
        <div className="pt-2 mt-2 border-t text-xs">
          <p className="text-muted-foreground mb-1">Vanligaste kategorier:</p>
          <div className="flex flex-wrap gap-1">
            {requester.topCategories.slice(0, 2).map((cat, i) => (
              <span key={i} className="px-2 py-0.5 bg-muted rounded-full">
                {cat.category} ({cat.count})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Reports = () => {
  const { users } = useUsers();
  const isMobile = useIsMobile();
  const mode = useMode();
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [kpiModalOpen, setKpiModalOpen] = useState<string | null>(null);

  // Fetch all report summary data from the new endpoint
  const { data: summary, isLoading, isError, error } = useReportsSummary(selectedYear, selectedMonth);

  // Raw ticket rows are only needed for the KPIDetailDialog drill-down modals.
  // Fetch them LAZILY — only once a modal is opened — instead of eagerly on page
  // load. (All chart aggregation now comes from server-side report endpoints, so
  // the page no longer pulls up to 1000 raw tickets just to render charts.)
  const { data: drilldownTickets = [] } = useQuery({
    queryKey: ['reports', 'drilldown-tickets'],
    enabled: kpiModalOpen !== null,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const response = await api.getTickets('?limit=1000&status=all');
      const rows = Array.isArray(response) ? response : response.data;
      return rows.map(mapTicketRow);
    },
  });

  // Get available years from summary trend data
  const availableYears = useMemo(() => {
    if (!summary?.trend || summary.trend.length === 0) {
      return [String(new Date().getFullYear())];
    }
    const yearSet = new Set<string>();
    summary.trend.forEach(t => {
      const year = t.month.substring(0, 4);
      yearSet.add(year);
    });
    return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  }, [summary?.trend]);

  // Requester analytics — server-side aggregation via /reports/requester-analytics
  const { data: requesterAnalytics = [] } = useQuery<RequesterAnalyticsRow[]>({
    queryKey: ['reports', 'requester-analytics', selectedYear, selectedMonth],
    queryFn: () => api.getRequesterAnalytics(selectedYear, selectedMonth),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // yearMonthFilteredTickets is still used for the KPIDetailDialog "total" modal
  const yearMonthFilteredTickets = useMemo(() => {
    let filtered = drilldownTickets;

    if (selectedYear !== 'all') {
      const year = parseInt(selectedYear);
      filtered = filtered.filter((ticket) => {
        const createdYear = new Date(ticket.createdAt).getFullYear();
        return createdYear === year;
      });
    }

    if (selectedMonth !== 'all') {
      const month = parseInt(selectedMonth);
      filtered = filtered.filter((ticket) => {
        const createdMonth = new Date(ticket.createdAt).getMonth();
        return createdMonth === month;
      });
    }

    return filtered;
  }, [drilldownTickets, selectedYear, selectedMonth]);

  // Summary KPIs for requester analytics
  const requesterKPIs = useMemo(() => {
    if (requesterAnalytics.length === 0) {
      return {
        totalRequesters: 0,
        avgTicketsPerRequester: 0,
        workloadBalance: 0,
        avgCompletionRate: 0,
      };
    }

    const totalRequesters = requesterAnalytics.length;
    const avgTicketsPerRequester = requesterAnalytics.reduce(
      (sum, r) => sum + r.totalTickets, 0
    ) / totalRequesters;

    // Workload balance: coefficient of variation (lower = more balanced)
    const stdDev = Math.sqrt(
      requesterAnalytics.reduce((sum, r) =>
        sum + Math.pow(r.totalTickets - avgTicketsPerRequester, 2), 0
      ) / totalRequesters
    );
    const workloadBalance = avgTicketsPerRequester > 0
      ? (stdDev / avgTicketsPerRequester) * 100
      : 0;

    const avgCompletionRate = requesterAnalytics.reduce(
      (sum, r) => sum + r.completionRate, 0
    ) / totalRequesters;

    return {
      totalRequesters,
      avgTicketsPerRequester,
      workloadBalance,
      avgCompletionRate,
    };
  }, [requesterAnalytics]);

  // Responsive chart configuration
  const chartMargins = useMemo(() => {
    return isMobile
      ? { left: 0, right: 0, top: 5, bottom: 5 }
      : { left: 20, right: 20 };
  }, [isMobile]);

  const userAxisWidth = useMemo(() => {
    if (isMobile) return 70; // Fixed narrow width on mobile
    const maxNameLength = requesterAnalytics.reduce((max, item) => Math.max(max, item.name.length), 0);
    const estimatedWidth = maxNameLength * 7 + 16;
    return Math.min(220, Math.max(100, estimatedWidth));
  }, [requesterAnalytics, isMobile]);

  const chartHeight = useMemo(() => {
    const base = isMobile ? 300 : 400;
    const perRow = isMobile ? 22 : 32;
    return Math.max(base, requesterAnalytics.length * perRow);
  }, [requesterAnalytics.length, isMobile]);

  // Derive ticketsByStatus from summary for status distribution display
  const ticketsByStatus = useMemo(() => {
    if (!summary) return [];
    const { totals } = summary;
    return [
      { name: 'Öppen', value: totals.open, status: 'open' },
      { name: 'Pågående', value: totals.inProgress, status: 'in-progress' },
      { name: 'Väntar', value: totals.waiting, status: 'waiting' },
      { name: 'Löst', value: totals.resolved, status: 'resolved' },
      { name: 'Stängd', value: totals.closed, status: 'closed' },
    ];
  }, [summary]);

  // Status KPIs derived from summary
  const statusKPIs = useMemo(() => {
    if (!summary) {
      return {
        total: 0,
        activeTickets: 0,
        resolvedRate: 0,
        dominantStatus: { name: '-', percentage: 0, status: 'open' },
      };
    }
    const { totals } = summary;
    const total = totals.total;
    if (total === 0) {
      return {
        total: 0,
        activeTickets: 0,
        resolvedRate: 0,
        dominantStatus: { name: '-', percentage: 0, status: 'open' },
      };
    }
    const activeTickets = totals.open + totals.inProgress + totals.waiting;
    const resolvedCount = totals.resolved + totals.closed;
    const resolvedRate = (resolvedCount / total) * 100;
    const dominant = ticketsByStatus.reduce((max, item) =>
      item.value > max.value ? item : max
    , ticketsByStatus[0]);

    return {
      total,
      activeTickets,
      resolvedRate,
      dominantStatus: {
        name: dominant?.name ?? '-',
        percentage: dominant ? (dominant.value / total) * 100 : 0,
        status: dominant?.status ?? 'open',
      },
    };
  }, [summary, ticketsByStatus]);

  // ticketsByPriority — derived from server-side summary.byPriority (full dataset, not paginated)
  const ticketsByPriority = useMemo(() => {
    if (!summary?.byPriority) return [];
    const priorityLabels: Record<string, string> = {
      'low': 'Låg',
      'medium': 'Medium',
      'high': 'Hög',
      'critical': 'Kritisk',
    };
    return summary.byPriority.map(({ priority, count }) => ({
      name: priorityLabels[priority] || priority,
      value: count,
    }));
  }, [summary?.byPriority]);

  const selectedUserName = useMemo(() => {
    if (selectedUserId === 'all') return 'Alla användare';
    if (selectedUserId === 'unassigned') return 'Ej tilldelad';
    return users.find(u => u.id === selectedUserId)?.name || 'Okänd';
  }, [selectedUserId, users]);

  // KPI values from summary
  const totalTickets = summary?.totals.total ?? 0;
  const avgResolutionTime = summary?.avgResolutionDays ?? 0;
  const resolutionRate = useMemo(() => {
    if (!summary) return 0;
    const { totals } = summary;
    if (totals.total === 0) return 0;
    return ((totals.resolved + totals.closed) / totals.total) * 100;
  }, [summary]);
  const agingTickets = summary?.agingTickets ?? 0;

  // agingTicketsData still needs raw tickets for the detail modal (lazily fetched)
  const agingTicketsData = useMemo(() => {
    return drilldownTickets.filter(t => {
      if (t.status !== 'open') return false;
      const daysSinceCreated = differenceInDays(new Date(), t.createdAt);
      return daysSinceCreated > 7;
    });
  }, [drilldownTickets]);

  // Monthly trend data for KPICard sparklines (from summary.trend)
  const monthlyTrendData = useMemo(() => {
    if (!summary?.trend) return [];
    return summary.trend.slice(-12).map(t => ({
      month: t.month,
      value: t.created,
    }));
  }, [summary?.trend]);

  // Ticket trend (month-over-month) from summary.trend
  const ticketTrend = useMemo(() => {
    if (!summary?.trend || summary.trend.length < 2) {
      return { value: 0, direction: 'up' as const };
    }
    const sorted = [...summary.trend].sort((a, b) => a.month.localeCompare(b.month));
    const thisMonth = sorted[sorted.length - 1]?.created ?? 0;
    const lastMonth = sorted[sorted.length - 2]?.created ?? 0;
    if (lastMonth === 0) return { value: 0, direction: 'up' as const };
    const percentChange = ((thisMonth - lastMonth) / lastMonth) * 100;
    return {
      value: Math.abs(percentChange),
      direction: percentChange >= 0 ? 'up' as const : 'down' as const,
    };
  }, [summary?.trend]);

  // CSV Export handler
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();

      // Add year filter if not "all"
      if (selectedYear !== 'all') {
        params.append('year', selectedYear);

        // Add month filter if selected
        if (selectedMonth !== 'all') {
          params.append('month', selectedMonth);
        }
      }

      params.append('source', 'rapport');
      const queryString = `?${params.toString()}`;

      await api.exportTickets(queryString);

      const filterDesc = selectedYear === 'all'
        ? 'alla ärenden'
        : selectedMonth === 'all'
          ? `ärenden från ${selectedYear}`
          : `ärenden från ${MONTH_NAMES[parseInt(selectedMonth)]} ${selectedYear}`;

      toast.success(`Excel-export klar: ${filterDesc}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Kunde inte exportera rapportdata');
    }
  };

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold font-serif text-foreground">Rapporter</h1>
            <p className="text-muted-foreground mt-2 text-lg font-light">Ärendeanalys och insikter</p>
          </div>
          <div className="reports-filter-bar flex flex-wrap items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedYear} onValueChange={(value) => {
              setSelectedYear(value);
              if (value === 'all') setSelectedMonth('all');
            }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Välj år" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla år</SelectItem>
                {availableYears.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedYear !== 'all' && (
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Välj månad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla månader</SelectItem>
                  {MONTH_NAMES.map((month, index) => (
                    <SelectItem key={index} value={index.toString()}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="w-px h-6 bg-border" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export Excel</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="gap-2 print:hidden"
              data-print-hide
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Skriv ut</span>
            </Button>
          </div>
        </div>

        {/* Error state */}
        {isError && (
          <Alert variant="destructive">
            <AlertTitle>Kunde inte ladda rapportdata</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : 'Kontrollera anslutningen och ladda om sidan.'}
            </AlertDescription>
          </Alert>
        )}

        {/* KPI Detail Modals */}
        <KPIDetailDialog
          open={kpiModalOpen === 'aging'}
          onOpenChange={(open) => setKpiModalOpen(open ? 'aging' : null)}
          title="Gamla ärenden"
          description={`Ärenden som har varit öppna i mer än 7 dagar (${agingTickets} totalt)`}
          tickets={agingTicketsData}
          users={users}
        />

        <KPIDetailDialog
          open={kpiModalOpen === 'total'}
          onOpenChange={(open) => setKpiModalOpen(open ? 'total' : null)}
          title="Alla ärenden"
          description={`Alla ärenden i aktuell vy (${totalTickets} totalt)`}
          tickets={yearMonthFilteredTickets}
          users={users}
        />

        {/* Empty state when no tickets exist */}
        {!isLoading && !isError && totalTickets === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">Inga ärenden att visa statistik för</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Skapa ärenden för att se rapporter och trender här.</p>
          </div>
        )}

        <Tabs defaultValue="översikt">
          {/* Mobile: horizontal scroll. Desktop: 5-col grid. */}
          <TabsList className="w-full h-auto flex overflow-x-auto whitespace-nowrap md:grid md:grid-cols-5">
            <TabsTrigger value="översikt" className="shrink-0 md:shrink">Översikt</TabsTrigger>
            <TabsTrigger value="trend" className="shrink-0 md:shrink">Trend</TabsTrigger>
            <TabsTrigger value="personer" className="shrink-0 md:shrink">Personer</TabsTrigger>
            <TabsTrigger value="taggar" className="shrink-0 md:shrink">Taggar</TabsTrigger>
            <TabsTrigger value="tid" className="shrink-0 md:shrink">Tid</TabsTrigger>
          </TabsList>

          {/* ── Flik 1: Översikt ── */}
          <TabsContent value="översikt" className="space-y-5 mt-5">

            {/* Hero KPI Cards */}
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="Totalt"
                  value={totalTickets}
                  icon={<Ticket className="w-6 h-6" />}
                  sparklineData={monthlyTrendData}
                  trend={{
                    value: ticketTrend.value,
                    direction: ticketTrend.direction,
                    isPositive: ticketTrend.direction === 'down',
                  }}
                  animationDelay={0}
                  onClick={() => setKpiModalOpen('total')}
                />

                <KPICard
                  label="Snitt upplösningstid"
                  value={avgResolutionTime}
                  valueDecimals={1}
                  valueSuffix="d"
                  icon={<Clock className="w-6 h-6" />}
                  animationDelay={100}
                />

                <KPICard
                  label="Lösningsgrad"
                  value={resolutionRate}
                  valueDecimals={0}
                  valueSuffix="%"
                  icon={<CheckCircle className="w-6 h-6" />}
                  animationDelay={200}
                />

                <KPICard
                  label="Gamla ärenden"
                  value={agingTickets}
                  icon={<AlertTriangle className="w-6 h-6" />}
                  className="border-destructive/30"
                  animationDelay={300}
                  onClick={() => setKpiModalOpen('aging')}
                />
              </div>
            )}

            {/* Status Distribution */}
            <Card className="animate-fade-in" style={{ animationDelay: '350ms' }}>
              <CardHeader className="flex flex-row items-center gap-2">
                <PieChartIcon className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl font-semibold font-serif">Ärenden per status</CardTitle>
              </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className="h-[300px] w-full" />
                  ) : statusKPIs.total === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      Ingen ärendedata tillgänglig
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <Card className="relative overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <Ticket className="w-4 h-4 text-primary" />
                          </div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total</p>
                          <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                            {statusKPIs.total}
                          </p>
                        </CardContent>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </Card>

                      <Card className="relative overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <Clock className="w-4 h-4 text-primary" />
                          </div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Vanligast</p>
                          <div className="flex items-baseline gap-2">
                            <p className="text-lg font-semibold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent truncate">
                              {statusKPIs.dominantStatus.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {statusKPIs.dominantStatus.percentage.toFixed(0)}%
                            </p>
                          </div>
                        </CardContent>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </Card>

                      <Card className="relative overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <AlertTriangle className="w-4 h-4 text-primary" />
                          </div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Aktiva</p>
                          <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                            {statusKPIs.activeTickets}
                          </p>
                        </CardContent>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </Card>

                      <Card className="relative overflow-hidden">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <CheckCircle className="w-4 h-4 text-primary" />
                          </div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Lösningsgrad</p>
                          <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                            {statusKPIs.resolvedRate.toFixed(0)}%
                          </p>
                          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-linear-to-r from-primary to-accent transition-[width] duration-300"
                              style={{ width: `${statusKPIs.resolvedRate}%` }}
                            />
                          </div>
                        </CardContent>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </Card>
                    </div>
                  )}
                </CardContent>
            </Card>

            {/* Priority Chart */}
            <Card className="animate-fade-in" style={{ animationDelay: '300ms' }}>
              <CardHeader className="flex flex-row items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl font-semibold font-serif">Ärenden per prioritet</CardTitle>
              </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className="h-[300px] w-full" />
                  ) : ticketsByPriority.length === 0 ? (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      Ingen ärendedata tillgänglig
                    </div>
                  ) : (
                    <ResponsiveContainer key={mode} width="100%" height={isMobile ? 180 : 200}>
                      <BarChart data={ticketsByPriority} margin={chartMargins}>
                        <defs>
                          {COLORS.map((color, index) => (
                            <linearGradient key={`priorityGradient${index}`} id={`priorityGradient${index}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={color} stopOpacity={0.95}/>
                              <stop offset="95%" stopColor={color} stopOpacity={0.7}/>
                            </linearGradient>
                          ))}
                        </defs>
                        <XAxis dataKey="name" tick={{ fontSize: isMobile ? 10 : 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: isMobile ? 10 : 12 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                          }}
                          itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                          cursor={{ fill: 'hsl(var(--muted) / 0.2)' }}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={800} animationEasing="ease-out">
                          {ticketsByPriority.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={`url(#priorityGradient${index % COLORS.length})`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
            </Card>

            {/* Category Breakdown Chart */}
            <Card className="animate-fade-in" style={{ animationDelay: '400ms' }}>
              <CardHeader className="flex flex-row items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl font-semibold font-serif">Kategorier</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : !summary?.byCategory || summary.byCategory.length === 0 ? (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    Inga kategorier
                  </div>
                ) : (
                  <ResponsiveContainer key={mode} width="100%" height={Math.max(200, summary.byCategory.length * 40)}>
                    <BarChart
                      layout="vertical"
                      data={summary.byCategory}
                      margin={{ left: 80, right: 20, top: 5, bottom: 5 }}
                    >
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={80} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Bar dataKey="count" name="Ärenden" radius={[0, 4, 4, 0]}>
                        {summary.byCategory.map((_, index) => (
                          <Cell key={`cell-cat-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Flik 2: Trend ── */}
          <TabsContent value="trend" className="space-y-5 mt-5">

            {/* Created vs Closed Trend — ComposedChart */}
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl font-semibold font-serif">Skapade och stängda ärenden</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : !summary?.trend || summary.trend.length === 0 ? (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    Ingen trenddata tillgänglig
                  </div>
                ) : (
                  <ResponsiveContainer key={mode} width="100%" height={300}>
                    <ComposedChart data={summary.trend} margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="created" name="Skapad" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Line type="monotone" dataKey="closed" name="Stängd" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Status Flow */}
            <Card className="animate-fade-in" style={{ animationDelay: '500ms' }}>
              <CardHeader>
                <CardTitle className="text-xl font-semibold font-serif">Statusflöde över tid</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Statusfördelning de senaste 12 månaderna
                </p>
              </CardHeader>
              <CardContent>
                <StatusFlowChart height={isMobile ? 250 : 300} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Flik 3: Personer ── */}
          <TabsContent value="personer" className="space-y-5 mt-5">
            <Card className="animate-fade-in" style={{ animationDelay: '700ms' }}>
              <CardHeader className="flex flex-row items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl font-semibold font-serif">Per person</CardTitle>
              </CardHeader>
                <CardContent>
                  {/* KPI Summary - enkla divs utan nästlade Card-komponenter */}
                  {requesterAnalytics.length > 0 && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                      <div className="relative overflow-hidden p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <Users className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Antal personer</p>
                        <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                          {requesterKPIs.totalRequesters}
                        </p>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </div>

                      <div className="relative overflow-hidden p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <BarChart3 className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Snitt per person</p>
                        <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                          {requesterKPIs.avgTicketsPerRequester.toFixed(1)}
                        </p>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </div>

                      <div className="relative overflow-hidden p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <Scale className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Arbetsbelastning</p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                            {requesterKPIs.workloadBalance.toFixed(0)}%
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {requesterKPIs.workloadBalance < 50 ? 'Balanserat' : 'Ojämnt'}
                          </p>
                        </div>
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-linear-to-r from-primary to-accent transition-all duration-500"
                            style={{ width: `${Math.min(100, requesterKPIs.workloadBalance)}%` }}
                          />
                        </div>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </div>

                      <div className="relative overflow-hidden p-4 rounded-lg border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <CheckCircle className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Snitt avslutning</p>
                        <p className="text-2xl font-mono font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
                          {requesterKPIs.avgCompletionRate.toFixed(0)}%
                        </p>
                        <div className="absolute top-0 right-0 w-20 h-20 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                      </div>
                    </div>
                  )}

                  {/* Stacked Bar Chart */}
                  {requesterAnalytics.length === 0 ? (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      Ingen ärendedata tillgänglig
                    </div>
                  ) : (
                    <ResponsiveContainer key={mode} width="100%" height={chartHeight}>
                      <BarChart data={requesterAnalytics} layout="vertical" margin={chartMargins}>
                        <defs>
                          {Object.entries(REQUESTER_STATUS_COLORS).map(([status, color]) => (
                            <linearGradient key={status} id={`requester-${status}`} x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor={color} stopOpacity={0.95} />
                              <stop offset="50%" stopColor={color} stopOpacity={1} />
                              <stop offset="100%" stopColor={color} stopOpacity={0.8} />
                            </linearGradient>
                          ))}
                        </defs>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: isMobile ? 10 : 12 }} />
                        <YAxis type="category" dataKey="name" width={userAxisWidth} interval={0} tick={{ fontSize: isMobile ? 10 : 12 }} />
                        <Tooltip content={<RequesterTooltip />} />
                        <Legend
                          wrapperStyle={{ paddingTop: '16px' }}
                          iconType="square"
                          formatter={(value) => {
                            const status = value.replace('statusBreakdown.', '');
                            return statusLabels[status] || status;
                          }}
                        />
                        {['closed', 'resolved', 'waiting', 'in-progress', 'open'].map((status) => (
                          <Bar
                            key={status}
                            dataKey={`statusBreakdown.${status}`}
                            stackId="status"
                            fill={`url(#requester-${status})`}
                            radius={status === 'open' ? [0, 4, 4, 0] : 0}
                            onClick={(bar) => setSelectedUserId(bar.payload.userId)}
                            className="cursor-pointer requester-bar"
                            animationDuration={800}
                            animationEasing="ease-out"
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Flik 4: Taggar ── */}
          <TabsContent value="taggar" className="space-y-5 mt-5">
            <div className="animate-fade-in" style={{ animationDelay: '600ms' }}>
              <TagAnalytics />
            </div>
          </TabsContent>

          {/* ── Flik 5: Tid ── */}
          <TabsContent value="tid" className="space-y-5 mt-5">
            <div className="animate-fade-in" style={{ animationDelay: '600ms' }}>
              <TimeSummaryTab year={selectedYear} month={selectedMonth} />
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </Layout>
  );
};

export default Reports;
