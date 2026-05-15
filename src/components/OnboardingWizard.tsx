import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanies } from '@/hooks/useCompanies';
import { Building2, Users, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function OnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1 state
  const [companyName, setCompanyName] = useState('');
  const [orgNumber, setOrgNumber] = useState('');

  const { createCompany } = useCompanies();

  useEffect(() => {
    const completed = localStorage.getItem('onboarding_completed');
    if (!completed) setOpen(true);
  }, []);

  const complete = () => {
    localStorage.setItem('onboarding_completed', 'true');
    setOpen(false);
  };

  const handleStep1 = async () => {
    if (!companyName.trim()) {
      toast.error('Ange ett företagsnamn');
      return;
    }
    setIsSubmitting(true);
    try {
      await createCompany({ name: companyName.trim(), org_number: orgNumber.trim() || undefined });
    } catch {
      // non-fatal — user can add company later
    } finally {
      setIsSubmitting(false);
    }
    setStep(2);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) complete();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-w-md">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-2">
          {[1, 2].map(i => (
            <div
              key={i}
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-colors',
                i <= step ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-primary" />
                <DialogTitle>Välkommen! Skapa ditt första företag</DialogTitle>
              </div>
              <DialogDescription>
                Lägg till ett kundföretag för att börja skapa ärenden. Du kan alltid lägga till fler senare.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="ob-company-name">Företagsnamn *</Label>
                <Input
                  id="ob-company-name"
                  placeholder="Företagsnamn AB"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleStep1()}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-org-number">Organisationsnummer (valfritt)</Label>
                <Input
                  id="ob-org-number"
                  placeholder="556xxx-xxxx"
                  value={orgNumber}
                  onChange={e => setOrgNumber(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleStep1()}
                />
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={complete}>Hoppa över allt</Button>
                <Button onClick={handleStep1} disabled={isSubmitting}>
                  Nästa
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-5 h-5 text-primary" />
                <DialogTitle>Allt klart!</DialogTitle>
              </div>
              <DialogDescription>
                Systemet är redo att användas. Du kan bjuda in fler användare och konfigurera mer under Inställningar.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Check className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">Företag skapat</p>
                  {companyName && <p className="text-xs text-muted-foreground">{companyName}</p>}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={complete}>
                  Kom igång
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
