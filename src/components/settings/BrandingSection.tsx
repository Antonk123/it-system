import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Image as ImageIcon, Loader2, Upload, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranding, brandingKeys } from '@/hooks/useBranding';
import { api } from '@/lib/api';
import logoDefault from '@/assets/logo-default.svg';

// Måste spegla backendens allowlist EXAKT (ALLOWED_LOGO_MIME_TYPES/MAX_LOGO_SIZE
// i server/src/lib/branding.ts, använd av POST /api/settings/branding/logo i
// server/src/routes/settings.ts) — SVG är medvetet uteslutet där, så accept
// ska inte erbjuda det i filväljaren: annars väljer admin en SVG, servern
// avvisar den, och det upplevs som ett trasigt formulär. Ändras den ena
// sidans allowlist, uppdatera den andra i samma commit.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_ACCEPT = ALLOWED_TYPES.join(',');
const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB — måste matcha backendens gräns

/**
 * Admin-only: ladda upp en egen logotyp eller återställ till standardmärket.
 * Följer samma mönster som EmailBehaviorSection — self-gating på
 * user?.role, react-query + toast, ingen egen fetch.
 */
export function BrandingSection() {
  const { user } = useAuth();
  const { logoUrl } = useBranding();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadBrandingLogo(file),
    onSuccess: () => {
      setPreviewFailed(false);
      queryClient.invalidateQueries({ queryKey: brandingKeys.all });
      toast.success('Logotyp uppdaterad');
    },
    onError: () => toast.error('Kunde inte ladda upp logotypen'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBrandingLogo(),
    onSuccess: () => {
      setPreviewFailed(false);
      queryClient.invalidateQueries({ queryKey: brandingKeys.all });
      toast.success('Återställd till standardlogotyp');
    },
    onError: () => toast.error('Kunde inte återställa logotypen'),
  });

  // Admin-only inställning — IntegrationsTab/GeneralTab visas för alla roller,
  // så komponenten self-gatear (samma mönster som EmailBehaviorSection).
  if (user?.role !== 'admin') return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // tillåt att välja samma fil igen efter avvisning
    if (!file) return;

    // Klientvalidering för snabb feedback — servern är ändå sista instans
    // (avvisar t.ex. förfalskade MIME-typer den upptäcker via filsignatur).
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Ogiltig filtyp. Tillåtna format: PNG, JPEG eller WebP.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error('Filen är för stor. Max 1 MB.');
      return;
    }

    uploadMutation.mutate(file);
  };

  const isBusy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          Logotyp
        </CardTitle>
        <CardDescription>
          Ladda upp en egen logotyp som visas på inloggningssidan och i sidofältet. Utan egen logotyp används standardmärket.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden border shrink-0 bg-muted flex items-center justify-center">
            <img
              src={logoUrl && !previewFailed ? logoUrl : logoDefault}
              alt="Aktuell logotyp"
              className="w-full h-full object-cover"
              onError={() => setPreviewFailed(true)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={isBusy}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Ladda upp logotyp
            </Button>
            {logoUrl && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => deleteMutation.mutate()}
                disabled={isBusy}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Återställ till standard
              </Button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
          aria-label="Ladda upp logotyp"
        />
        <p className="text-xs text-muted-foreground">
          PNG, JPEG eller WebP. Max 1 MB.
        </p>
      </CardContent>
    </Card>
  );
}
