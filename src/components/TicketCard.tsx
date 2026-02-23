import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Clock, User as UserIcon } from 'lucide-react';
import { Ticket, User } from '@/types/ticket';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';

interface TicketCardProps {
  ticket: Ticket;
  user?: User;
}

export const TicketCard = ({ ticket, user }: TicketCardProps) => {
  return (
    <Link to={`/tickets/${ticket.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h3 className="font-medium text-foreground line-clamp-1 flex-1">
              {ticket.title}
            </h3>
            <StatusBadge status={ticket.status} />
          </div>
          
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {ticket.description}
          </p>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <PriorityBadge priority={ticket.priority} />
              {user && (
                <div className="flex items-center gap-1">
                  <UserIcon className="w-3.5 h-3.5" />
                  <span>{user.name}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{format(ticket.createdAt, 'MMM d, yyyy')}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};
