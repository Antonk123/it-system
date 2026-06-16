import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { format, isToday, isTomorrow } from 'date-fns';
import { sv } from 'date-fns/locale';
import type { UpcomingReminder } from '@/hooks/useUpcomingReminders';
import { parseServerDate } from '@/lib/date';

interface RemindersPanelProps {
  reminders: UpcomingReminder[] | undefined;
  isLoading: boolean;
}

function formatReminderTime(date: Date): string {
  if (isToday(date)) return `idag ${format(date, 'HH:mm')}`;
  if (isTomorrow(date)) return `imorgon ${format(date, 'HH:mm')}`;
  return format(date, 'EEE d MMM HH:mm', { locale: sv });
}

export const RemindersPanel = ({ reminders, isLoading }: RemindersPanelProps) => {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-start gap-2">
          <Bell className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-foreground leading-tight">Kommande påminnelser</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
              Osända påminnelser sorterade efter tidpunkt
            </p>
          </div>
        </div>
        {reminders && reminders.length > 5 && (
          <button
            onClick={() => navigate('/tickets?status=open')}
            className="text-xs font-semibold text-primary underline-offset-2 hover:underline shrink-0 ml-2"
          >
            Visa alla
          </button>
        )}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : !reminders || reminders.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm font-semibold text-muted-foreground">Inga kommande påminnelser</p>
            <p className="text-xs text-muted-foreground mt-1">Lägg till påminnelser på ärenden för att se dem här.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {reminders.slice(0, 5).map((reminder) => (
              <div
                key={reminder.id}
                onClick={() => navigate(`/tickets/${reminder.ticket_id}`)}
                className="flex items-center gap-3 px-1 py-2 rounded-md cursor-pointer hover:bg-muted/40 transition-colors duration-150"
              >
                <Bell className="w-3.5 h-3.5 text-primary shrink-0" />
                <p
                  className="text-sm font-semibold text-foreground truncate flex-1"
                  title={reminder.ticket_title}
                >
                  {reminder.ticket_title}
                </p>
                <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
                  {formatReminderTime(parseServerDate(reminder.reminder_time))}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
