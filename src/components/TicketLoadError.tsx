import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { getErrorStatus } from '@/lib/apiErrorStatus';

interface TicketLoadErrorProps {
  /** Felet från ärende-queryn; saknas det betyder det att ärendet inte finns. */
  error: unknown;
  onRetry: () => void;
}

/** Felpanel för sidor som inte kunde ladda ett enskilt ärende: 404 skiljs från övriga fel. */
export const TicketLoadError = ({ error, onRetry }: TicketLoadErrorProps) => {
  const loadFailed = Boolean(error) && getErrorStatus(error) !== 404;

  return (
    <div className="text-center py-16" role={loadFailed ? 'alert' : undefined}>
      <p className="text-foreground font-medium">
        {loadFailed ? 'Kunde inte hämta ärendet' : 'Ärendet finns inte'}
      </p>
      <p className="text-muted-foreground text-sm mt-1">
        {loadFailed ? 'Kontrollera din anslutning och försök igen.' : 'Det kan ha tagits bort.'}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {loadFailed && <Button onClick={onRetry}>Försök igen</Button>}
        <Button asChild variant={loadFailed ? 'outline' : 'default'}>
          <Link to="/tickets">Tillbaka till ärenden</Link>
        </Button>
      </div>
    </div>
  );
};
