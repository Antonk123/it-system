import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { ticketKeys } from '@/hooks/useTickets';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

export const QuickCaptureFAB = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [titleError, setTitleError] = useState(false);

  if (!isAuthenticated) return null;

  const handleSubmit = async () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    setIsSubmitting(true);
    try {
      const newTicket = await api.createTicket({
        title: title.trim(),
        description: ' ',
        status: 'open',
        priority: 'medium',
        category_id: null,
        requester_id: user!.id,
      });
      await queryClient.invalidateQueries({ queryKey: ticketKeys.lists() });
      setOpen(false);
      setTitle('');
      toast.success('Ärende skapat', {
        action: {
          label: 'Öppna',
          onClick: () => navigate(`/tickets/${newTicket.id}`),
        },
      });
    } catch {
      toast.error('Något gick fel. Försök igen eller ladda om sidan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    if (titleError && e.target.value.trim()) setTitleError(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setTitle('');
      setTitleError(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl active:scale-95 transition-transform duration-200"
              aria-label="Snabbt ärende"
            >
              <Plus className="h-6 w-6" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Snabbt ärende</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" side="top" className="w-80 p-6">
        <p className="text-base font-semibold mb-4">Nytt ärende</p>
        <Input
          autoFocus
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleKeyDown}
          placeholder="Vad behöver du hjälp med?"
          className={titleError ? 'border-destructive' : ''}
        />
        {titleError && (
          <p className="text-xs text-destructive mt-1">Ange en rubrik för att fortsätta</p>
        )}
        <Button
          className="w-full mt-4"
          onClick={handleSubmit}
          disabled={isSubmitting || !title.trim()}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sparar...
            </>
          ) : (
            'Skicka in'
          )}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
