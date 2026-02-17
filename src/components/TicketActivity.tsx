import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { History, RefreshCcw, AlertTriangle, Edit2, StickyNote, Lightbulb, Tag, Plus } from 'lucide-react';
import { TicketHistoryItem } from '@/lib/api';

const STATUS_LABELS: Record<string, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const PRIORITY_LABELS: Record<string, string> = {
  'low': 'Låg',
  'medium': 'Medium',
  'high': 'Hög',
  'critical': 'Kritisk',
};

function getActivityInfo(item: TicketHistoryItem): { icon: React.ReactNode; text: string } {
  switch (item.field_name) {
    case 'created':
      return { icon: <Plus className="w-4 h-4" />, text: 'Ärende skapat' };
    case 'status':
      return {
        icon: <RefreshCcw className="w-4 h-4" />,
        text: `Status: ${STATUS_LABELS[item.old_value ?? ''] ?? item.old_value} → ${STATUS_LABELS[item.new_value ?? ''] ?? item.new_value}`,
      };
    case 'priority':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        text: `Prioritet: ${PRIORITY_LABELS[item.old_value ?? ''] ?? item.old_value} → ${PRIORITY_LABELS[item.new_value ?? ''] ?? item.new_value}`,
      };
    case 'category_id':
      return {
        icon: <Tag className="w-4 h-4" />,
        text: item.old_value
          ? `Kategori: ${item.old_value} → ${item.new_value ?? 'Ingen'}`
          : `Kategori satt till: ${item.new_value ?? 'Ingen'}`,
      };
    case 'title':
      return { icon: <Edit2 className="w-4 h-4" />, text: 'Titel uppdaterades' };
    case 'notes':
      return { icon: <StickyNote className="w-4 h-4" />, text: 'Anteckningar uppdaterades' };
    case 'solution':
      return {
        icon: <Lightbulb className="w-4 h-4" />,
        text: item.new_value === 'added' ? 'Lösning tillagd' : 'Lösning uppdaterades',
      };
    default:
      return { icon: <History className="w-4 h-4" />, text: `${item.field_name} uppdaterades` };
  }
}

interface TicketActivityProps {
  history: TicketHistoryItem[];
  isLoading: boolean;
}

export const TicketActivity = ({ history, isLoading }: TicketActivityProps) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-medium text-foreground">Aktivitetslogg</h3>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laddar...</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ingen aktivitet registrerad.</p>
      ) : (
        <div className="space-y-2">
          {history.map((item) => {
            const { icon, text } = getActivityInfo(item);
            return (
              <div key={item.id} className="flex items-start gap-3 text-sm">
                <div className="mt-0.5 text-muted-foreground flex-shrink-0">
                  {icon}
                </div>
                <div>
                  <span className="text-foreground">{text}</span>
                  <span className="text-muted-foreground ml-2">
                    {item.user_name ? `av ${item.user_name} · ` : ''}
                    {format(new Date(item.changed_at), 'PPP HH:mm', { locale: sv })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
