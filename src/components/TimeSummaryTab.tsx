import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/duration';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function TimeSummaryTab({ year, month }: { year: string; month: string }) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'time-summary', year, month],
    queryFn: () => api.getTimeReportsSummary(year, month),
  });

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data || (data.byCategory.length === 0 && data.topTickets.length === 0)) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <Clock className="mx-auto mb-3 opacity-50" size={32} />
        <p>Ingen tidsdata hittades for vald period</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Card 1: Time per category bar chart (TIME-05) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tid per kategori</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.byCategory} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" tickFormatter={(v) => formatDuration(v)} />
              <YAxis
                type="category"
                dataKey="category"
                width={140}
                tick={{ fontSize: 13 }}
              />
              <Tooltip
                formatter={(value: number) => [formatDuration(value), 'Tid']}
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid hsl(var(--border))',
                }}
              />
              <Bar dataKey="total_minutes" radius={[0, 4, 4, 0]}>
                {data.byCategory.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Card 2: Top 10 tickets table (TIME-06) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topp 10 arenden efter tid</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.topTickets.map((ticket, i) => (
              <div
                key={ticket.id}
                className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => navigate(`/tickets/${ticket.id}`)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-sm font-medium text-muted-foreground w-5">
                    {i + 1}
                  </span>
                  <span className="text-sm truncate">{ticket.title}</span>
                </div>
                <span className="text-sm font-medium ml-3 whitespace-nowrap">
                  {formatDuration(ticket.total_minutes)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
