import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompanies } from '@/hooks/useCompanies';
import { useSLAPolicies } from '@/hooks/useSLAPolicies';
import { Building2, Clock, Users, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const PRIORITIES = [
  { key: 'critical', label: 'Kritisk', defaultResponse: 30, defaultResolution: 240 },
  { key: 'high', label: 'Hög', defaultResponse: 60, defaultResolution: 480 },
  { key: 'medium', label: 'Medium', defaultResponse: 240, defaultResolution: 1440 },
  { key: 'low', label: 'Låg', defaultResponse: 480, defaultResolution: 2880 },
];

export function OnboardingWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1 state
  const [companyName, setCompanyName] = useState('');
  const [orgNumber, setOrgNumber] = useState('');

  // Step 2 state — response/resolution times in minutes
  const [slaTimes, setSlaTimes] = useState(
    PRIORITIES.map(p => ({
      priority: p.key,
      response_time_minutes: p.defaultResponse,
      resolution_time_minutes: p.defaultResolution,
    }))
  );

  const { createCompany } = useCompanies();
  const { upsertPolicies } = useSLAPolicies('default');

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

  const handleStep2 = async () => {
    setIsSubmitting(true);
    try {
      await upsertPolicies(null, slaTimes);
    } catch {
      // non-fatal
    } finally {
      setIsSubmitting(false);
    }
    setStep(3);
  };

  const updateSlaTime = (priority: string, field: 'response_time_minutes' | 'resolution_time_minutes', value: string) => {
    const mins = Math.max(1, parseInt(value, 10) || 0);
    setSlaTimes(prev => prev.map(p => p.priority === priority ? { ...p, [field]: mins } : p));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-2">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className={cn(
                'w-2.5 h-2.5 rounded-full transition-colors',
                i < step ? 'bg-primary' : i === step ? 'bg-primary' : 'bg-muted'
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
                  placeholder="Prefab Mästarna AB"
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
                <Clock className="w-5 h-5 text-primary" />
                <DialogTitle>SLA-policy (svarstider)</DialogTitle>
              </div>
              <DialogDescription>
                Ange hur snabbt ärenden ska besvaras och lösas per prioritet (i minuter).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground font-medium px-1">
                <span>Prioritet</span>
                <span>Svar (min)</span>
                <span>Lösning (min)</span>
              </div>
              {PRIORITIES.map(p => {
                const row = slaTimes.find(s => s.priority === p.key)!;
                return (
                  <div key={p.key} className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-sm font-medium">{p.label}</span>
                    <Input
                      type="number"
                      min={1}
                      value={row.response_time_minutes}
                      onChange={e => updateSlaTime(p.key, 'response_time_minutes', e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={row.resolution_time_minutes}
                      onChange={e => updateSlaTime(p.key, 'resolution_time_minutes', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                );
              })}
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(1)}>Tillbaka</Button>
                <Button onClick={handleStep2} disabled={isSubmitting}>
                  Nästa
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
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
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Check className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">SLA-policy konfigurerad</p>
                  <p className="text-xs text-muted-foreground">Standard-policy för alla prioriteter</p>
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
