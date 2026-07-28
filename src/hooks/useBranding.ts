import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const brandingKeys = {
  all: ['branding'] as const,
};

/**
 * Läser den konfigurerade logotyp-URL:en (eller null om ingen är satt →
 * BrandLogo faller tillbaka på standardmärket). api.getBranding() degraderar
 * redan internt till { logoUrl: null } vid fel eller icke-200-svar (se
 * kommentar i api.ts), så ingen extra felhantering krävs här. Logotypen
 * ändras nästan aldrig — lång staleTime undviker onödiga omhämtningar på
 * varje sidladdning, inklusive på oinloggade sidor.
 */
export function useBranding() {
  const { data } = useQuery({
    queryKey: brandingKeys.all,
    queryFn: () => api.getBranding(),
    staleTime: 60 * 60 * 1000, // 1 timme
    retry: false,
  });

  return { logoUrl: data?.logoUrl ?? null };
}
