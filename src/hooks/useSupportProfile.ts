import { useEffect, useState } from 'react';

export interface SupportProfile { name: string; email: string; photo: string | null }
const hosts = ['https://navet.prefabmastarna.se', 'https://navet-dev.prefabmastarna.se'];

// Display/prefill only. This message never authenticates an IT-Ticket session.
export function useSupportProfile(enabled: boolean) {
  const [profile, setProfile] = useState<SupportProfile | null>(null);
  useEffect(() => {
    if (!enabled || window.parent === window) return;
    // A service-worker reload can make referrer point to IT-Ticket itself.
    // Only the empty readiness signal may use '*'; profile data is accepted
    // solely from the actual parent at an exact allowed Navet origin.
    let origin = window.location.ancestorOrigins?.[0] || '';
    if (!origin) { try { origin = new URL(document.referrer).origin; } catch { /* no referrer */ } }
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !hosts.includes(event.origin)) return;
      const data = event.data;
      if (!data || data.type !== 'prefabnavet.support-profile' || data.version !== 1) return;
      if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100
        || typeof data.email !== 'string' || !data.email.includes('@') || data.email.length > 255) return;
      const photo = typeof data.photo === 'string' && data.photo.length <= 32768
        && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(data.photo) ? data.photo : null;
      setProfile({ name: data.name, email: data.email, photo });
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'prefabnavet.support-ready', version: 1 }, hosts.includes(origin) ? origin : '*');
    return () => window.removeEventListener('message', receive);
  }, [enabled]);
  return profile;
}
