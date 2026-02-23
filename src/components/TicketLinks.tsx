import { useState } from 'react';
import { Link as LinkIcon, X, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TicketLink } from '@/types/ticket';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface TicketLinksProps {
  links: TicketLink[];
  isLoading: boolean;
  currentTicketId: string;
  onAddLink: (targetTicketId: string) => Promise<void>;
  onDeleteLink: (linkId: string) => Promise<void>;
}

export const TicketLinks = ({
  links,
  isLoading,
  currentTicketId,
  onAddLink,
  onDeleteLink,
}: TicketLinksProps) => {
  const [newLinkId, setNewLinkId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAddLink = async () => {
    if (!newLinkId.trim()) {
      toast.error('Please enter a ticket ID');
      return;
    }

    if (newLinkId.trim() === currentTicketId) {
      toast.error('Cannot link a ticket to itself');
      return;
    }

    setIsAdding(true);
    try {
      await onAddLink(newLinkId.trim());
      setNewLinkId('');
      toast.success('Link created successfully');
    } catch (error: any) {
      const message = error.message || 'Failed to create link';
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      await onDeleteLink(linkId);
      toast.success('Link removed successfully');
    } catch (error) {
      toast.error('Failed to remove link');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-foreground flex items-center gap-2 text-sm">
        <LinkIcon className="w-4 h-4 text-muted-foreground" />
        Related Tickets ({links.length})
      </h3>

      {/* Add new link form */}
      <div className="flex gap-2">
        <Input
          value={newLinkId}
          onChange={(e) => setNewLinkId(e.target.value)}
          placeholder="Enter ticket ID to link..."
          className="text-xs"
          disabled={isAdding}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAddLink();
            }
          }}
        />
        <Button
          onClick={handleAddLink}
          disabled={isAdding || !newLinkId.trim()}
          size="sm"
          className="text-xs"
        >
          {isAdding ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            'Link'
          )}
        </Button>
      </div>

      {/* Links list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No linked tickets yet
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg hover:bg-muted transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <Link
                  to={`/tickets/${link.linkedTicket.id}`}
                  className="text-sm font-medium truncate hover:underline block"
                >
                  {link.linkedTicket.title}
                </Link>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    #{link.linkedTicket.id.slice(0, 8)}
                  </span>
                  <StatusBadge status={link.linkedTicket.status} />
                  <PriorityBadge priority={link.linkedTicket.priority} />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                onClick={() => handleDeleteLink(link.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
