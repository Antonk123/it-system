import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { Ticket, Tag } from '@/types/ticket';
import { cn } from '@/lib/utils';

interface TagDistributionChartProps {
  tickets: Ticket[];
  tags: Tag[];
  onTagClick?: (tagId: string) => void;
  topN?: number;
  className?: string;
}

interface TagDistData {
  name: string;
  count: number;
  tagId: string;
  color: string;
}

export const TagDistributionChart = ({
  tickets,
  tags,
  onTagClick,
  topN = 10,
  className,
}: TagDistributionChartProps) => {
  const navigate = useNavigate();

  // Calculate tag distribution data
  const tagDistData = useMemo(() => {
    const tagCounts = new Map<string, number>();

    tickets.forEach(ticket => {
      ticket.tags?.forEach(tag => {
        tagCounts.set(tag.id, (tagCounts.get(tag.id) || 0) + 1);
      });
    });

    return tags
      .filter(tag => tagCounts.has(tag.id))
      .map(tag => ({
        name: tag.name,
        count: tagCounts.get(tag.id) || 0,
        tagId: tag.id,
        color: tag.color,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }, [tickets, tags, topN]);

  // Generate unique gradient IDs for each tag
  const gradients = useMemo(() => {
    return tagDistData.map(tag => ({
      id: `gradient-${tag.tagId}-${Math.random().toString(36).substr(2, 9)}`,
      color: tag.color,
    }));
  }, [tagDistData]);

  // Handle bar click
  const handleBarClick = (data: TagDistData) => {
    if (onTagClick) {
      onTagClick(data.tagId);
    } else {
      // Navigate to tickets page with tag filter
      navigate(`/tickets?tags=${data.tagId}`);
    }
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload as TagDistData;

    return (
      <div className="bg-popover text-popover-foreground px-4 py-2 rounded-lg shadow-lg border">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: data.color }}
          />
          <span className="font-semibold">{data.name}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {data.count} {data.count === 1 ? 'ticket' : 'tickets'}
        </div>
      </div>
    );
  };

  // Custom bar label
  const renderBarLabel = (props: any) => {
    const { x, y, width, value } = props;
    return (
      <text
        x={x + width + 5}
        y={y + 12}
        fill="hsl(var(--muted-foreground))"
        fontSize={12}
        fontFamily="monospace"
      >
        {value}
      </text>
    );
  };

  if (tagDistData.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-64 text-muted-foreground', className)}>
        No tag data available
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={Math.max(tagDistData.length * 40 + 60, 300)}>
        <BarChart
          data={tagDistData}
          layout="vertical"
          margin={{ top: 10, right: 40, left: 10, bottom: 10 }}
        >
          <defs>
            {gradients.map((gradient, index) => (
              <linearGradient key={gradient.id} id={gradient.id} x1="0" y1="0" x2="1" y2="0">
                <stop offset="5%" stopColor={gradient.color} stopOpacity={0.8} />
                <stop offset="95%" stopColor={gradient.color} stopOpacity={0.4} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" opacity={0.3} horizontal={false} />

          <XAxis
            type="number"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />

          <YAxis
            type="category"
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
            width={120}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.2)' }} />

          <Bar
            dataKey="count"
            radius={[0, 8, 8, 0]}
            animationDuration={1000}
            animationEasing="ease-out"
            onClick={handleBarClick}
            cursor="pointer"
            label={renderBarLabel}
          >
            {tagDistData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={`url(#${gradients[index].id})`}
                className="hover:opacity-80 transition-opacity"
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
