import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface KBPortalShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KBPortalShareDialog({ open, onOpenChange }: KBPortalShareDialogProps) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isRevokeConfirmOpen, setIsRevokeConfirmOpen] = useState(false);
  const publicUrlInputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const revokeButtonRef = useRef<HTMLButtonElement>(null);
  const shouldFocusPublicUrlRef = useRef(false);
  const shouldFocusCreateButtonRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoading(true);
    api.getKbPortalShare()
      .then(({ share_token }) => {
        if (!cancelled) setShareToken(share_token);
      })
      .catch(() => {
        if (!cancelled) {
          setShareToken(null);
          toast.error('Kunde inte hämta publik länk');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const publicUrl = useMemo(
    () => shareToken ? `${window.location.origin}/kb/public/${shareToken}` : '',
    [shareToken],
  );

  // En ny token ersätter skapa-knappen med URL-fältet. Vänta tills React har
  // monterat den nya vyn innan fokus flyttas, så tangentbordsanvändaren direkt
  // hamnar där länken kan läsas eller kopieras.
  useEffect(() => {
    if (!shareToken || !shouldFocusPublicUrlRef.current) return;
    shouldFocusPublicUrlRef.current = false;
    requestAnimationFrame(() => publicUrlInputRef.current?.focus());
  }, [shareToken]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const { share_token } = await api.createKbPortalShare();
      shouldFocusPublicUrlRef.current = true;
      setShareToken(share_token);
      toast.success('Publik länk skapad');
    } catch {
      toast.error('Kunde inte skapa publik länk');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Länk kopierad');
    } catch {
      toast.error('Kunde inte kopiera länken');
    }
  };

  const handleOpen = () => {
    if (!publicUrl) return;
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  };

  const handleRevoke = async () => {
    setIsRevoking(true);
    try {
      await api.revokeKbPortalShare();
      shouldFocusCreateButtonRef.current = true;
      setShareToken(null);
      setIsRevokeConfirmOpen(false);
      toast.success('Publik länk återkallad');
    } catch {
      toast.error('Kunde inte återkalla publik länk');
    } finally {
      setIsRevoking(false);
    }
  };

  // Återkallelsedialogen styrs av state, inte av AlertDialogTrigger. Radix har
  // därför ingen trigger att säkert återställa fokus till. Vid lyckad
  // återkallelse försvinner dessutom den gamla Återkalla-knappen ur DOM:en;
  // vi avbryter Radix standardåterställning och väntar tills skapa-knappen är
  // monterad. Vid Avbryt/Escape går fokus i stället tillbaka till den ännu
  // existerande återkalla-knappen.
  const handleRevokeConfirmCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    const shouldFocusCreateButton = shouldFocusCreateButtonRef.current;
    shouldFocusCreateButtonRef.current = false;
    requestAnimationFrame(() => {
      if (shouldFocusCreateButton) {
        createButtonRef.current?.focus();
      } else {
        revokeButtonRef.current?.focus();
      }
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publik länk</DialogTitle>
            <DialogDescription>
              Dela kunskapsbasen med personer som inte har ett konto i ärendesystemet.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Hämtar status för publik länk...
            </div>
          ) : shareToken ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="kb-portal-share-url" className="text-sm font-medium">
                  Publik länk
                </label>
                <Input ref={publicUrlInputRef} id="kb-portal-share-url" value={publicUrl} readOnly />
              </div>
              <p className="text-sm text-muted-foreground">
                Alla med länken kan läsa alla publicerade artiklar. Utkast visas inte.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Alla med länken kan läsa alla publicerade artiklar. Utkast visas inte.</p>
              <p>Skapa bara en länk om den får delas med externa mottagare.</p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {shareToken ? (
              <>
                <Button type="button" variant="outline" className="min-h-11" onClick={handleCopy} disabled={isRevoking}>
                  <Copy className="mr-2" />
                  Kopiera
                </Button>
                <Button type="button" variant="outline" className="min-h-11" onClick={handleOpen} disabled={isRevoking}>
                  <ExternalLink className="mr-2" />
                  Öppna i ny flik
                </Button>
                <Button
                  type="button"
                  ref={revokeButtonRef}
                  variant="destructive"
                  className="min-h-11"
                  onClick={() => setIsRevokeConfirmOpen(true)}
                  disabled={isRevoking}
                >
                  {isRevoking ? <Loader2 className="mr-2 animate-spin" /> : <Link2 className="mr-2" />}
                  Återkalla
                </Button>
              </>
            ) : (
              <Button
                ref={createButtonRef}
                type="button"
                className="min-h-11"
                onClick={handleCreate}
                disabled={isCreating || isLoading}
              >
                {isCreating ? <Loader2 className="mr-2 animate-spin" /> : <Link2 className="mr-2" />}
                {isCreating ? 'Skapar...' : 'Skapa publik länk'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isRevokeConfirmOpen}
        onOpenChange={(nextOpen) => {
          // Behåll bekräftelsen monterad medan återkallningen pågår, även om
          // Escape trycks, så fokus alltid kan flyttas till rätt efterföljare.
          if (!nextOpen && isRevoking) return;
          setIsRevokeConfirmOpen(nextOpen);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={handleRevokeConfirmCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Återkalla publik länk?</AlertDialogTitle>
            <AlertDialogDescription>
              Länken slutar fungera direkt. Du kan skapa en ny länk senare, men den får en ny adress.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={isRevoking}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={(event) => {
                // AlertDialogAction är en Dialog.Close. Behåll dialogen öppen
                // medan DELETE pågår; annars kör Radix sin autofocus innan
                // create-knappen finns i DOM:en.
                event.preventDefault();
                void handleRevoke();
              }}
              disabled={isRevoking}
            >
              {isRevoking && <Loader2 className="mr-2 animate-spin" />}
              Återkalla länk
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
