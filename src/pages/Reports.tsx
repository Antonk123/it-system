import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Layout } from '@/components/Layout';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TicketTable } from '@/components/TicketTable';
import { BarChart3, PieChart as PieChartIcon, Filter, Calendar } from 'lucide-react';

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const STATUS_COLORS: Record<string, string> = {
  open: 'hsl(var(--chart-1))',
  'in-progress': 'hsl(var(--chart-2))',
  waiting: 'hsl(var(--chart-5))',
  resolved: 'hsl(var(--chart-3))',
  closed: 'hsl(var(--chart-4))',
};

const MONTH_NAMES = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
];

const Reports = () => {
  const { tickets } = useTickets();
  const { users } = useUsers();
  const isMobile = useIsMobile();
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

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

  // Tickets by requester (user) - filtered by year and month
  const ticketsByUser = useMemo(() => {
    const counts: Record<string, { name: string; count: number; userId: string }> = {};
    
    yearMonthFilteredTickets.forEach(ticket => {
      const user = users.find(u => u.id === ticket.requesterId);
      const userName = user?.name || 'Ej tilldelad';
      const userId = ticket.requesterId || 'unassigned';
      
      if (!counts[userId]) {
        counts[userId] = { name: userName, count: 0, userId };
      }
      counts[userId].count++;
    });
    
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }, [yearMonthFilteredTickets, users]);

  // Responsive chart configuration
  const chartMargins = useMemo(() => {
    return isMobile
      ? { left: 0, right: 0, top: 5, bottom: 5 }
      : { left: 20, right: 20 };
  }, [isMobile]);

  const userAxisWidth = useMemo(() => {
    if (isMobile) return 70; // Fixed narrow width on mobile
    const maxNameLength = ticketsByUser.reduce((max, item) => Math.max(max, item.name.length), 0);
    const estimatedWidth = maxNameLength * 7 + 16;
    return Math.min(220, Math.max(100, estimatedWidth));
  }, [ticketsByUser, isMobile]);

  const userChartHeight = useMemo(() => {
    const base = isMobile ? 250 : 300;
    const perRow = isMobile ? 18 : 26;
    return Math.max(base, ticketsByUser.length * perRow);
  }, [ticketsByUser.length, isMobile]);

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

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Rapporter</h1>
            <p className="text-muted-foreground mt-1">Ärendeanalys och insikter</p>
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
          </div>
        </div>

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
        {selectedYear !== 'all' && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Ärenden skapade per månad ({selectedYear})</CardTitle>
            </CardHeader>
            <CardContent>
              {ticketsByMonth.every(m => m.count === 0) ? (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  Inga ärenden under {selectedYear}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
                  <BarChart data={ticketsByMonth} margin={chartMargins}>
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
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                      onClick={(data) => setSelectedMonth(data.monthIndex.toString())}
                      className="cursor-pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tickets by User Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Ärenden per beställare</CardTitle>
            </CardHeader>
            <CardContent>
              {ticketsByUser.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Ingen ärendedata tillgänglig
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={userChartHeight}>
                  <BarChart data={ticketsByUser} layout="vertical" margin={chartMargins}>
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: isMobile ? 10 : 12 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={userAxisWidth}
                      interval={0}
                      tick={{ fontSize: isMobile ? 10 : 12 }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      cursor={{ fill: 'hsl(var(--muted))' }}
                    />
                    <Bar 
                      dataKey="count" 
                      fill="hsl(var(--primary))" 
                      radius={[0, 4, 4, 0]}
                      onClick={(data) => setSelectedUserId(data.userId)}
                      className="cursor-pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Tickets by Status Pie Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Ärenden per status</CardTitle>
            </CardHeader>
            <CardContent>
              {yearMonthFilteredTickets.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Ingen ärendedata tillgänglig
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={isMobile ? 250 : 300}>
                  <PieChart>
                    <Pie
                      data={ticketsByStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={isMobile ? 35 : 60}
                      outerRadius={isMobile ? 65 : 100}
                      paddingAngle={2}
                      dataKey="value"
                      label={isMobile ? false : ({ name, value }) => value > 0 ? `${name}: ${value}` : ''}
                      labelLine={false}
                    >
                      {ticketsByStatus.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={STATUS_COLORS[entry.status] || COLORS[index % COLORS.length]} 
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: isMobile ? '12px' : '14px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Priority Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Ärenden per prioritet</CardTitle>
          </CardHeader>
          <CardContent>
            {yearMonthFilteredTickets.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                Ingen ärendedata tillgänglig
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 200}>
                <BarChart data={ticketsByPriority} margin={chartMargins}>
                  <XAxis dataKey="name" tick={{ fontSize: isMobile ? 10 : 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: isMobile ? 10 : 12 }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    cursor={{ fill: 'hsl(var(--muted))' }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {ticketsByPriority.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Filter and Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">
                Ärenden för {selectedUserName}
              </CardTitle>
            </div>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrera på användare" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla användare</SelectItem>
                {ticketsByUser.map((item) => (
                  <SelectItem key={item.userId} value={item.userId}>
                    {item.name} ({item.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <TicketTable tickets={filteredTickets} users={users} />
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Reports;
