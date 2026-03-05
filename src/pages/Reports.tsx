import { useMemo, useState } from 'react';
import { differenceInDays, format, startOfMonth, subMonths, isSameMonth, subDays, startOfDay, isSameDay, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Layout } from '@/components/Layout';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useTags } from '@/hooks/useTags';
import { useIsMobile } from '@/hooks/use-mobile';
import { RequesterAnalytics } from '@/types/ticket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { TicketTable } from '@/components/TicketTable';
import { KPICard } from '@/components/KPICard';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { StatusFlowChart } from '@/components/StatusFlowChart';
import { TagAnalytics } from '@/components/TagAnalytics';
import { RadialProgressRings } from '@/components/RadialProgressRings';
import { ReportsCustomization } from '@/components/ReportsCustomization';
import { KPIDetailDialog } from '@/components/KPIDetailDialog';
import { useReportsPreferences } from '@/hooks/useReportsPreferences';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { BarChart3, PieChart as PieChartIcon, Filter, Calendar, Ticket, Clock, CheckCircle, AlertTriangle, Users, Scale, Download } from 'lucide-react';

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

  const requester = payload[0].payload as RequesterAnalytics;

  return (
    <div className="bg-popover text-popover-foreground px-4 py-3 rounded-lg shadow-lg border max-w-xs backdrop-blur-sm">
      {/* Header with gradient accent */}
      <div className="mb-3 pb-2 border-b relative">
        <p className="font-semibold font-serif text-base bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          {requester.name}
        </p>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary/50 via-accent/50 to-transparent" />
      </div>

      {/* Status breakdown */}
      <div className="space-y-1.5 text-sm mb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
          Status Breakdown
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
          <span className="text-muted-foreground">Completion Rate:</span>
          <span className="font-mono font-semibold">
            {requester.completionRate.toFixed(0)}%
          </span>
        </div>
        {requester.avgResolutionTime > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Avg Resolution:</span>
            <span className="font-mono font-semibold">
              {requester.avgResolutionTime.toFixed(1)}d
            </span>
          </div>
        )}
        {requester.agingTickets > 0 && (
          <div className="flex justify-between text-destructive">
            <span>Aging Tickets:</span>
            <span className="font-mono font-semibold">
              {requester.agingTickets}
            </span>
          </div>
        )}
      </div>

      {/* Top categories (if available) */}
      {requester.topCategories.length > 0 && (
        <div className="pt-2 mt-2 border-t text-xs">
          <p className="text-muted-foreground mb-1">Top Categories:</p>
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
  const { tickets } = useTickets();
  const { users } = useUsers();
  const { tags } = useTags();
  const isMobile = useIsMobile();
  const { preferences } = useReportsPreferences();
  const [selectedUserId, setSelectedUserId] = useState<string>('all');

  // Helper to check if a module is visible
  const isModuleVisible = (moduleId: string) => {
    return preferences.modules.find(m => m.id === moduleId)?.visible ?? true;
  };
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [kpiModalOpen, setKpiModalOpen] = useState<string | null>(null);

  // Get available years from tickets
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    tickets.forEach((ticket) => {
      const createdYear = new Date(ticket.createdAt).getFullYear();
      years.add(createdYear);
      if (ticket.closedAt) {
        years.add(new Date(ticket.closedAt).getFullYear());
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [tickets]);

  // Filter tickets by year and month
  const yearMonthFilteredTickets = useMemo(() => {
    let filtered = tickets;
    
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
  }, [tickets, selectedYear, selectedMonth]);

  // Tickets closed by year (for overview chart)
  const ticketsClosedByYear = useMemo(() => {
    const yearMap = new Map<number, number>();
    tickets.forEach((ticket) => {
      if (ticket.closedAt) {
        const year = new Date(ticket.closedAt).getFullYear();
        const count = yearMap.get(year) || 0;
        yearMap.set(year, count + 1);
      }
    });
    return Array.from(yearMap.entries())
      .map(([year, count]) => ({ year: year.toString(), count }))
      .sort((a, b) => parseInt(a.year) - parseInt(b.year));
  }, [tickets]);

  // Tickets by month (for selected year)
  const ticketsByMonth = useMemo(() => {
    if (selectedYear === 'all') return [];
    
    const year = parseInt(selectedYear);
    const monthCounts = new Array(12).fill(0);
    
    tickets.forEach((ticket) => {
      const date = new Date(ticket.createdAt);
      if (date.getFullYear() === year) {
        monthCounts[date.getMonth()]++;
      }
    });
    
    return monthCounts.map((count, index) => ({
      month: MONTH_NAMES[index].substring(0, 3),
      fullMonth: MONTH_NAMES[index],
      monthIndex: index,
      count,
    }));
  }, [tickets, selectedYear]);

  // Requester analytics - comprehensive metrics per requester (OPTIMIZED)
  const requesterAnalytics = useMemo(() => {
    const analytics: Record<string, RequesterAnalytics> = {};
    const ticketsByRequester: Record<string, typeof yearMonthFilteredTickets> = {};
    const now = new Date();

    // SINGLE PASS: Group tickets by requester and calculate basic metrics
    yearMonthFilteredTickets.forEach(ticket => {
      const user = users.find(u => u.id === ticket.requesterId);
      const userName = user?.name || 'Ej tilldelad';
      const userId = ticket.requesterId || 'unassigned';

      // Initialize if first ticket for this requester
      if (!analytics[userId]) {
        analytics[userId] = {
          userId,
          name: userName,
          totalTickets: 0,
          statusBreakdown: { open: 0, 'in-progress': 0, waiting: 0, resolved: 0, closed: 0 },
          priorityBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
          completionRate: 0,
          avgResolutionTime: 0,
          agingTickets: 0,
          lastTicketDate: ticket.createdAt,
          ticketVelocity: 0,
          topCategories: [],
          topTags: [],
        };
        ticketsByRequester[userId] = [];
      }

      const a = analytics[userId];
      ticketsByRequester[userId].push(ticket);

      // Update counters
      a.totalTickets++;
      a.statusBreakdown[ticket.status]++;
      a.priorityBreakdown[ticket.priority]++;

      // Track latest ticket
      if (ticket.createdAt > a.lastTicketDate) {
        a.lastTicketDate = ticket.createdAt;
      }

      // Count aging tickets inline
      if (ticket.status === 'open' && differenceInDays(now, ticket.createdAt) > 7) {
        a.agingTickets++;
      }
    });

    // Calculate derived metrics using grouped tickets
    Object.entries(analytics).forEach(([userId, a]) => {
      const userTickets = ticketsByRequester[userId];

      // Completion rate
      const completedCount = a.statusBreakdown.resolved + a.statusBreakdown.closed;
      a.completionRate = a.totalTickets > 0 ? (completedCount / a.totalTickets) * 100 : 0;

      // Average resolution time (single pass over user's tickets)
      let totalResolutionDays = 0;
      let completedTicketCount = 0;
      let oldestTicketDate = now;

      const categoryMap = new Map<string, number>();
      const tagMap = new Map<string, number>();

      userTickets.forEach(t => {
        // Resolution time
        if ((t.status === 'resolved' || t.status === 'closed') && t.closedAt) {
          totalResolutionDays += differenceInDays(t.closedAt, t.createdAt);
          completedTicketCount++;
        }

        // Oldest ticket for velocity
        if (t.createdAt < oldestTicketDate) {
          oldestTicketDate = t.createdAt;
        }

        // Categories
        if (t.category) {
          categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + 1);
        }

        // Tags
        t.tags?.forEach(tag => {
          tagMap.set(tag.name, (tagMap.get(tag.name) || 0) + 1);
        });
      });

      // Set average resolution time
      a.avgResolutionTime = completedTicketCount > 0 ? totalResolutionDays / completedTicketCount : 0;

      // Calculate velocity
      const monthsActive = Math.max(1, differenceInDays(now, oldestTicketDate) / 30);
      a.ticketVelocity = a.totalTickets / monthsActive;

      // Top 3 categories
      a.topCategories = Array.from(categoryMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Top 3 tags
      a.topTags = Array.from(tagMap.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
    });

    // Sort by total tickets and limit to top 15 for performance
    return Object.values(analytics)
      .sort((a, b) => b.totalTickets - a.totalTickets)
      .slice(0, 15);
  }, [yearMonthFilteredTickets, users]);

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

  // Tickets by status - filtered by year and month
  const ticketsByStatus = useMemo(() => {
    const counts: Record<string, number> = {
      open: 0,
      'in-progress': 0,
      waiting: 0,
      resolved: 0,
      closed: 0,
    };

    yearMonthFilteredTickets.forEach(ticket => {
      counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    });

    const statusLabels: Record<string, string> = {
      'open': 'Öppen',
      'in-progress': 'Pågående',
      'waiting': 'Väntar',
      'resolved': 'Löst',
      'closed': 'Stängd',
    };

    return Object.entries(counts).map(([status, count]) => ({
      name: statusLabels[status] || status,
      value: count,
      status,
    }));
  }, [yearMonthFilteredTickets]);

  // Status KPIs
  const statusKPIs = useMemo(() => {
    const total = yearMonthFilteredTickets.length;
    if (total === 0) {
      return {
        total: 0,
        activeTickets: 0,
        resolvedRate: 0,
        dominantStatus: { name: '-', percentage: 0, status: 'open' },
      };
    }

    const statusCounts = ticketsByStatus.reduce((acc, item) => {
      acc[item.status] = item.value;
      return acc;
    }, {} as Record<string, number>);

    const activeTickets = (statusCounts.open || 0) + (statusCounts['in-progress'] || 0) + (statusCounts.waiting || 0);
    const resolvedCount = (statusCounts.resolved || 0) + (statusCounts.closed || 0);
    const resolvedRate = (resolvedCount / total) * 100;

    // Find dominant status
    const dominant = ticketsByStatus.reduce((max, item) =>
      item.value > max.value ? item : max
    );

    return {
      total,
      activeTickets,
      resolvedRate,
      dominantStatus: {
        name: dominant.name,
        percentage: (dominant.value / total) * 100,
        status: dominant.status,
      },
    };
  }, [ticketsByStatus, yearMonthFilteredTickets.length]);

  // Tickets by priority - filtered by year and month
  const ticketsByPriority = useMemo(() => {
    const counts: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    
    yearMonthFilteredTickets.forEach(ticket => {
      counts[ticket.priority] = (counts[ticket.priority] || 0) + 1;
    });
    
    const priorityLabels: Record<string, string> = {
      'low': 'Låg',
      'medium': 'Medium',
      'high': 'Hög',
      'critical': 'Kritisk',
    };
    
    return Object.entries(counts).map(([priority, count]) => ({
      name: priorityLabels[priority] || priority,
      value: count,
    }));
  }, [yearMonthFilteredTickets]);

  // Filtered tickets by selected user
  const filteredTickets = useMemo(() => {
    if (selectedUserId === 'all') {
      return yearMonthFilteredTickets;
    }
    if (selectedUserId === 'unassigned') {
      return yearMonthFilteredTickets.filter(t => !t.requesterId);
    }
    return yearMonthFilteredTickets.filter(t => t.requesterId === selectedUserId);
  }, [yearMonthFilteredTickets, selectedUserId]);

  const selectedUserName = useMemo(() => {
    if (selectedUserId === 'all') return 'Alla användare';
    if (selectedUserId === 'unassigned') return 'Ej tilldelad';
    return users.find(u => u.id === selectedUserId)?.name || 'Okänd';
  }, [selectedUserId, users]);

  // KPI Calculations
  const totalTickets = useMemo(() => tickets.length, [tickets]);

  const avgResolutionTime = useMemo(() => {
    const resolvedTickets = tickets.filter(t => t.closedAt && t.createdAt);
    if (resolvedTickets.length === 0) return 0;

    const totalDays = resolvedTickets.reduce((sum, ticket) => {
      const days = differenceInDays(ticket.closedAt!, ticket.createdAt);
      return sum + days;
    }, 0);

    return totalDays / resolvedTickets.length;
  }, [tickets]);

  const resolutionRate = useMemo(() => {
    if (tickets.length === 0) return 0;
    const resolvedCount = tickets.filter(
      t => t.status === 'resolved' || t.status === 'closed'
    ).length;
    return (resolvedCount / tickets.length) * 100;
  }, [tickets]);

  // Store full array of aging tickets for modal display
  const agingTicketsData = useMemo(() => {
    return tickets.filter(t => {
      if (t.status !== 'open') return false;
      const daysSinceCreated = differenceInDays(new Date(), t.createdAt);
      return daysSinceCreated > 7;
    });
  }, [tickets]);

  const agingTickets = agingTicketsData.length;

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

      const queryString = params.toString() ? `?${params.toString()}` : '';

      await api.exportTickets(queryString);

      const filterDesc = selectedYear === 'all'
        ? 'all tickets'
        : selectedMonth === 'all'
          ? `tickets from ${selectedYear}`
          : `tickets from ${MONTH_NAMES[parseInt(selectedMonth)]} ${selectedYear}`;

      toast.success(`CSV export successful: ${filterDesc}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export report data');
    }
  };

  // Monthly trend data for sparklines
  const monthlyTrendData = useMemo(() => {
    const last12Months = Array.from({ length: 12 }, (_, i) => {
      const date = subMonths(new Date(), 11 - i);
      return {
        month: format(date, 'MMM'),
        monthDate: startOfMonth(date),
      };
    });

    return last12Months.map(({ month, monthDate }) => {
      const count = tickets.filter(t => {
        const ticketMonth = startOfMonth(t.createdAt);
        return isSameMonth(ticketMonth, monthDate);
      }).length;
      return { month, value: count };
    });
  }, [tickets]);

  // Ticket trend (month-over-month)
  const ticketTrend = useMemo(() => {
    const thisMonth = tickets.filter(t =>
      isSameMonth(t.createdAt, new Date())
    ).length;

    const lastMonth = tickets.filter(t =>
      isSameMonth(t.createdAt, subMonths(new Date(), 1))
    ).length;

    if (lastMonth === 0) return { value: 0, direction: 'up' as const };

    const percentChange = ((thisMonth - lastMonth) / lastMonth) * 100;
    return {
      value: Math.abs(percentChange),
      direction: percentChange >= 0 ? 'up' as const : 'down' as const,
    };
  }, [tickets]);

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold font-serif text-foreground">Rapporter</h1>
            <p className="text-muted-foreground mt-2 text-lg font-light">Ärendeanalys och insikter</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                  <SelectItem key={year} value={year.toString()}>
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
              <span className="hidden sm:inline">Export CSV</span>
            </Button>
            <div className="w-px h-6 bg-border" />
            <ReportsCustomization />
          </div>
        </div>

        {/* Hero KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Total Tickets"
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
            label="Avg Resolution"
            value={avgResolutionTime}
            valueDecimals={1}
            valueSuffix="d"
            icon={<Clock className="w-6 h-6" />}
            animationDelay={100}
          />

          <KPICard
            label="Resolution Rate"
            value={resolutionRate}
            valueDecimals={0}
            valueSuffix="%"
            icon={<CheckCircle className="w-6 h-6" />}
            animationDelay={200}
          />

          <KPICard
            label="Aging Tickets"
            value={agingTickets}
            icon={<AlertTriangle className="w-6 h-6" />}
            className="border-destructive/30"
            animationDelay={300}
            onClick={() => setKpiModalOpen('aging')}
          />
        </div>

        {/* KPI Detail Modals */}
        <KPIDetailDialog
          open={kpiModalOpen === 'aging'}
          onOpenChange={(open) => setKpiModalOpen(open ? 'aging' : null)}
          title="Aging Tickets"
          description={`Tickets that have been open for more than 7 days (${agingTickets} total)`}
          tickets={agingTicketsData}
          users={users}
        />

        <KPIDetailDialog
          open={kpiModalOpen === 'total'}
          onOpenChange={(open) => setKpiModalOpen(open ? 'total' : null)}
          title="All Tickets"
          description={`All tickets in the current view (${totalTickets} total)`}
          tickets={yearMonthFilteredTickets}
          users={users}
        />

        {/* Tickets Closed by Year - Compact View */}
        <Card className="py-4">
          <CardContent className="py-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Stängda per år:</span>
              </div>
              {ticketsClosedByYear.length === 0 ? (
                <span className="text-sm text-muted-foreground">Inga stängda ärenden</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ticketsClosedByYear.map((item) => (
                    <button
                      key={item.year}
                      onClick={() => setSelectedYear(item.year)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                        selectedYear === item.year
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80 text-foreground'
                      }`}
                    >
                      <span>{item.year}</span>
                      <span className={`${selectedYear === item.year ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                        {item.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tickets by Month (when year is selected) */}
        {selectedYear !== 'all' && isModuleVisible('monthlyChart') && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl font-semibold font-serif">Ärenden skapade per månad ({selectedYear})</CardTitle>
            </CardHeader>
            <CardContent>
              {ticketsByMonth.every(m => m.count === 0) ? (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  Inga ärenden under {selectedYear}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
                  <BarChart data={ticketsByMonth} margin={chartMargins}>
                    <defs>
                      <linearGradient id="monthBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.9}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.6}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" tick={{ fontSize: isMobile ? 10 : 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: isMobile ? 10 : 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      formatter={(value, name, props) => [value, props.payload.fullMonth]}
                    />
                    <Bar
                      dataKey="count"
                      fill="url(#monthBarGradient)"
                      radius={[4, 4, 0, 0]}
                      onClick={(data) => setSelectedMonth(data.monthIndex.toString())}
                      className="cursor-pointer"
                      animationDuration={1000}
                      animationEasing="ease-out"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Requester Analytics */}
          {isModuleVisible('requesterAnalytics') && (
          <Card className="animate-fade-in" style={{ animationDelay: '700ms' }}>
            <CardHeader className="flex flex-row items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl font-semibold font-serif">
                Requester Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* KPI Summary Cards */}
              {requesterAnalytics.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                  {/* Total Requesters */}
                  <div>
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <Users className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Total Requesters
                        </p>
                        <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                          {requesterKPIs.totalRequesters}
                        </p>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>
                  </div>

                  {/* Avg per Requester */}
                  <div>
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <BarChart3 className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Avg per Requester
                        </p>
                        <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                          {requesterKPIs.avgTicketsPerRequester.toFixed(1)}
                        </p>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>
                  </div>

                  {/* Workload Balance */}
                  <div>
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <Scale className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Workload Balance
                        </p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            {requesterKPIs.workloadBalance.toFixed(0)}%
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {requesterKPIs.workloadBalance < 50 ? 'Balanced' : 'Skewed'}
                          </p>
                        </div>
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                            style={{ width: `${Math.min(100, requesterKPIs.workloadBalance)}%` }}
                          />
                        </div>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>
                  </div>

                  {/* Avg Completion */}
                  <div>
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <CheckCircle className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Avg Completion
                        </p>
                        <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                          {requesterKPIs.avgCompletionRate.toFixed(0)}%
                        </p>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>
                  </div>
                </div>
              )}

              {/* Stacked Bar Chart */}
              {requesterAnalytics.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Ingen ärendedata tillgänglig
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart
                    data={requesterAnalytics}
                    layout="vertical"
                    margin={chartMargins}
                  >
                    <defs>
                      {/* Enhanced gradient definitions for each status */}
                      {Object.entries(REQUESTER_STATUS_COLORS).map(([status, color]) => (
                        <linearGradient
                          key={status}
                          id={`requester-${status}`}
                          x1="0" y1="0" x2="1" y2="0"
                        >
                          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
                          <stop offset="50%" stopColor={color} stopOpacity={1} />
                          <stop offset="100%" stopColor={color} stopOpacity={0.8} />
                        </linearGradient>
                      ))}
                    </defs>

                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: isMobile ? 10 : 12 }}
                    />

                    <YAxis
                      type="category"
                      dataKey="name"
                      width={userAxisWidth}
                      interval={0}
                      tick={{ fontSize: isMobile ? 10 : 12 }}
                    />

                    <Tooltip content={<RequesterTooltip />} />

                    <Legend
                      wrapperStyle={{ paddingTop: '16px' }}
                      iconType="square"
                      formatter={(value) => {
                        // Extract status from "statusBreakdown.status" format
                        const status = value.replace('statusBreakdown.', '');
                        return statusLabels[status] || status;
                      }}
                    />

                    {/* Stacked bars - one per status (bottom to top: closed, resolved, waiting, in-progress, open) */}
                    {['closed', 'resolved', 'waiting', 'in-progress', 'open'].map((status) => (
                      <Bar
                        key={status}
                        dataKey={`statusBreakdown.${status}`}
                        stackId="status"
                        fill={`url(#requester-${status})`}
                        radius={status === 'open' ? [0, 4, 4, 0] : 0}
                        onClick={(data) => setSelectedUserId(data.userId)}
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
          )}

          {/* Tickets by Status Pie Chart */}
          {isModuleVisible('statusDistribution') && (
          <Card className="animate-fade-in" style={{ animationDelay: '350ms' }}>
            <CardHeader className="flex flex-row items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl font-semibold font-serif">Ärenden per status</CardTitle>
            </CardHeader>
            <CardContent>
              {yearMonthFilteredTickets.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Ingen ärendedata tillgänglig
                </div>
              ) : (
                <>
                  {/* KPI Summary Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    {/* Total Tickets */}
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <Ticket className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Total
                        </p>
                        <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                          {statusKPIs.total}
                        </p>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>

                    {/* Dominant Status */}
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <Clock className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Dominant Status
                        </p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-lg font-semibold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent truncate">
                            {statusKPIs.dominantStatus.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {statusKPIs.dominantStatus.percentage.toFixed(0)}%
                          </p>
                        </div>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>

                    {/* Active Tickets */}
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <AlertTriangle className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Active
                        </p>
                        <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                          {statusKPIs.activeTickets}
                        </p>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>

                    {/* Resolved Rate */}
                    <Card className="relative overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <CheckCircle className="w-4 h-4 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                          Resolved Rate
                        </p>
                        <p className="text-2xl font-mono font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                          {statusKPIs.resolvedRate.toFixed(0)}%
                        </p>
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                            style={{ width: `${statusKPIs.resolvedRate}%` }}
                          />
                        </div>
                      </CardContent>
                      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50" />
                    </Card>
                  </div>

                  {/* Radial Progress Rings */}
                  <RadialProgressRings
                    data={ticketsByStatus}
                    total={statusKPIs.total}
                  />
                </>
              )}
            </CardContent>
          </Card>
          )}
        </div>

        {/* Priority Chart */}
        {isModuleVisible('priorityChart') && (
        <Card className="animate-fade-in" style={{ animationDelay: '300ms' }}>
          <CardHeader className="flex flex-row items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle className="text-xl font-semibold font-serif">Ärenden per prioritet</CardTitle>
          </CardHeader>
          <CardContent>
            {yearMonthFilteredTickets.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                Ingen ärendedata tillgänglig
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
                <BarChart data={ticketsByPriority} margin={chartMargins}>
                  <defs>
                    {COLORS.map((color, index) => (
                      <linearGradient key={`priorityGradient${index}`} id={`priorityGradient${index}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.95}/>
                        <stop offset="95%" stopColor={color} stopOpacity={0.7}/>
                      </linearGradient>
                    ))}
                  </defs>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: isMobile ? 10 : 12 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: isMobile ? 10 : 12 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                    itemStyle={{
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    cursor={{ fill: 'hsl(var(--muted) / 0.2)' }}
                  />
                  <Bar
                    dataKey="value"
                    radius={[4, 4, 0, 0]}
                    animationDuration={800}
                    animationEasing="ease-out"
                  >
                    {ticketsByPriority.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={`url(#priorityGradient${index % COLORS.length})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        )}

        {/* Activity Heatmap */}
        {isModuleVisible('activityHeatmap') && (
        <Card className="animate-fade-in" style={{ animationDelay: '400ms' }}>
          <CardHeader>
            <CardTitle className="text-xl font-semibold font-serif">
              Activity Calendar
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Daily ticket creation volume over the past {isMobile ? '3' : '12'} months
            </p>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap
              tickets={tickets}
              monthsToShow={isMobile ? 3 : 12}
            />
          </CardContent>
        </Card>
        )}

        {/* Status Flow */}
        {isModuleVisible('statusFlow') && (
        <Card className="animate-fade-in" style={{ animationDelay: '500ms' }}>
          <CardHeader>
            <CardTitle className="text-xl font-semibold font-serif">
              Status Flow Over Time
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Status distribution across the last 12 months
            </p>
          </CardHeader>
          <CardContent>
            <StatusFlowChart
              tickets={tickets}
              height={isMobile ? 250 : 300}
            />
          </CardContent>
        </Card>
        )}

        {/* Tag Analytics */}
        {isModuleVisible('tagAnalytics') && (
        <div className="animate-fade-in" style={{ animationDelay: '600ms' }}>
          <TagAnalytics tickets={tickets} tags={tags} />
        </div>
        )}

      </div>
    </Layout>
  );
};

export default Reports;
