import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Mail } from 'lucide-react';
import { useSettings } from '@/hooks/useSettings';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Admin-only toggle for two-way email with customers. When off, the system stops
 * emailing external parties (public replies + new-ticket confirmations); internal
 * notifications and inbound mail→ticket are unaffected.
 */
export function EmailBehaviorSection() {
  const { user } = useAuth();
  const { twoWayEmailEnabled, isLoading, updateTwoWayEmail } = useSettings();

  // System-wide email policy — only admins may change it (IntegrationsTab itself
  // is shown to all roles, so this component self-gates).
  if (user?.role !== 'admin') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5" />
          E-postbeteende
        </CardTitle>
        <CardDescription>
          Styr om systemet skickar utgående e-post till kunder/externa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="two-way-email-switch" className="flex flex-col gap-1">
            <span className="font-medium">Två-vägs e-postkommunikation med kunder</span>
            <span className="text-sm text-muted-foreground font-normal">
              När av: inga svar eller mottagningsbekräftelser mejlas till kunder.
              Interna notiser och inkommande mejl→ärende påverkas inte.
            </span>
          </Label>
          <Switch
            id="two-way-email-switch"
            checked={twoWayEmailEnabled}
            disabled={isLoading || updateTwoWayEmail.isPending}
            onCheckedChange={(checked) => updateTwoWayEmail.mutate(checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
