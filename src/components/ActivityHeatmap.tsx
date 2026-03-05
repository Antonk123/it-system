import { useMemo, useState } from 'react';
import { subDays, startOfDay, isSameDay, format, getDay } from 'date-fns';
import { Ticket } from '@/types/ticket';
import { cn } from '@/lib/utils';

interface ActivityHeatmapProps {
  tickets: Ticket[];
  onDayClick?: (date: Date) => void;
  className?: string;
  monthsToShow?: number;
}

interface DayData {
  date: Date;
  count: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export const ActivityHeatmap = ({
  tickets,
  onDayClick,
  className,
  monthsToShow = 12,
}: ActivityHeatmapProps) => {
  const [hoveredDay, setHoveredDay] = useState<DayData | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Calculate heatmap data
  const heatmapData = useMemo(() => {
    const daysToShow = monthsToShow * 30; // Approximate days
    const days: DayData[] = [];
    const today = new Date();

    for (let i = daysToShow - 1; i >= 0; i--) {
      const date = subDays(today, i);
      const dayStart = startOfDay(date);

      const count = tickets.filter(t =>
        isSameDay(t.createdAt, dayStart)
      ).length;

      let intensity: 0 | 1 | 2 | 3 | 4;
      if (count === 0) intensity = 0;
      else if (count <= 2) intensity = 1;
      else if (count <= 5) intensity = 2;
      else if (count <= 10) intensity = 3;
      else intensity = 4;

      days.push({ date: dayStart, count, intensity });
    }

    return days;
  }, [tickets, monthsToShow]);

  // Get intensity color class
  const getIntensityClass = (intensity: 0 | 1 | 2 | 3 | 4) => {
    switch (intensity) {
      case 0: return 'bg-muted/30';
      case 1: return 'bg-primary/25';
      case 2: return 'bg-primary/50';
      case 3: return 'bg-primary/75';
      case 4: return 'bg-primary';
      default: return 'bg-muted/30';
    }
  };

  // Handle mouse enter
  const handleMouseEnter = (day: DayData, event: React.MouseEvent) => {
    setHoveredDay(day);
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  };

  // Handle mouse leave
  const handleMouseLeave = () => {
    setHoveredDay(null);
  };

  // Handle day click
  const handleDayClick = (day: DayData) => {
    if (onDayClick) {
      onDayClick(day.date);
    }
  };

  // Calculate weeks for grid layout
  const weeks = useMemo(() => {
    const weeksData: (DayData | null)[][] = [];
    let currentWeek: (DayData | null)[] = [];

    // Fill the first week with nulls until we reach the first day
    const firstDayOfWeek = getDay(heatmapData[0]?.date || new Date());
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push(null);
    }

    // Add all days to weeks
    heatmapData.forEach((day) => {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeksData.push(currentWeek);
        currentWeek = [];
      }
    });

    // Fill the last week with nulls if needed
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeksData.push(currentWeek);
    }

    return weeksData;
  }, [heatmapData]);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className={cn('relative', className)}>
      <div className="flex gap-2">
        {/* Day labels */}
        <div className="flex flex-col justify-around text-xs text-muted-foreground pr-2">
          {dayLabels.map((label, i) => (
            <div key={i} className="h-3" style={{ fontSize: '10px' }}>
              {i % 2 === 1 ? label : ''}
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex-1 overflow-x-auto">
          <div className="inline-flex gap-[2px]">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-[2px]">
                {week.map((day, dayIndex) => (
                  <div
                    key={dayIndex}
                    className={cn(
                      'w-3 h-3 rounded-sm transition-all duration-200',
                      day
                        ? cn(
                            getIntensityClass(day.intensity),
                            'cursor-pointer hover:ring-2 hover:ring-primary/50 hover:scale-110'
                          )
                        : 'bg-transparent'
                    )}
                    onMouseEnter={day ? (e) => handleMouseEnter(day, e) : undefined}
                    onMouseLeave={day ? handleMouseLeave : undefined}
                    onClick={day ? () => handleDayClick(day) : undefined}
                    title={day ? `${format(day.date, 'MMM d, yyyy')}: ${day.count} tickets` : ''}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
        <span>Less</span>
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={cn('w-3 h-3 rounded-sm', getIntensityClass(level as 0 | 1 | 2 | 3 | 4))}
            />
          ))}
        </div>
        <span>More</span>
      </div>

      {/* Tooltip */}
      {hoveredDay && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-popover text-popover-foreground px-3 py-2 rounded-lg shadow-lg border text-sm whitespace-nowrap">
            <div className="font-semibold">{format(hoveredDay.date, 'MMM d, yyyy')}</div>
            <div className="text-muted-foreground">
              {hoveredDay.count} {hoveredDay.count === 1 ? 'ticket' : 'tickets'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
