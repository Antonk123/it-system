import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Bell, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TicketReminder } from '@/hooks/useTicketReminders';
import { parseServerDate } from '@/lib/date';

interface ReminderListProps {
  reminders: TicketReminder[];
  onDeleteReminder: (reminderId: string) => Promise<void>;
  onClearSent?: () => Promise<void>;
}

export function ReminderList({ reminders, onDeleteReminder, onClearSent }: ReminderListProps) {
  if (reminders.length === 0) return null;

  const hasSent = reminders.some((r) => r.sent === 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Påminnelser
          </CardTitle>
          {hasSent && onClearSent && (
            <Button variant="ghost" size="sm" onClick={onClearSent} className="text-muted-foreground text-xs">
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Rensa skickade
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {reminders.map((reminder) => (
            <div
              key={reminder.id}
              className="flex items-start justify-between p-3 bg-muted rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {reminder.sent === 1 && (
                    <Check className="h-4 w-4 text-[hsl(var(--success))] shrink-0" />
                  )}
                  <span className={reminder.sent === 1 ? 'line-through text-muted-foreground' : 'font-medium'}>
                    {format(parseServerDate(reminder.reminder_time), 'PPP HH:mm', { locale: sv })}
                  </span>
                </div>
                {reminder.message && (
                  <p className="text-sm text-muted-foreground mt-1">{reminder.message}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Skapad av {reminder.user_name || 'okänd användare'}
                </p>
              </div>
              {reminder.sent === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteReminder(reminder.id)}
                  className="ml-2"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
