import { useState } from 'react';
import { useBranding } from '@/hooks/useBranding';
import logoDefault from '@/assets/logo-default.svg';

interface BrandLogoProps {
  className?: string;
  /**
   * Decorative ("") where an adjacent heading already announces the app name;
   * a real label where the logo is the only brand identifier on screen.
   * Caller decides per usage site — see BrandLogo.test.tsx / ticket report.
   */
  alt?: string;
}

/**
 * Varumärkeslogotyp. Visar den admin-uppladdade logotypen om en finns,
 * annars det medföljande standardmärket (src/assets/logo-default.svg).
 * Faller tillbaka till standardmärket även om logoUrl finns men bilden
 * misslyckas att laddas (t.ex. en raderad fil på servern) — annars visas
 * en trasig bildikon på bl.a. inloggningssidan.
 */
export function BrandLogo({ className, alt = '' }: BrandLogoProps) {
  const { logoUrl } = useBranding();
  const [failed, setFailed] = useState(false);
  const showDefault = !logoUrl || failed;

  return (
    <img
      // key: om logoUrl ändras (uppladdning/återställning) ska en tidigare
      // fel-flagga för en annan URL inte "läcka" och tvinga fram
      // standardmärket permanent — nytt element per URL nollställer felstatus.
      key={logoUrl ?? 'default'}
      src={showDefault ? logoDefault : logoUrl}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
