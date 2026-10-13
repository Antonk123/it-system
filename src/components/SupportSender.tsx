import { useState } from 'react';
import { getInitials } from '@/lib/avatar';

export function SupportSender({ name, photo }: { name: string; photo?: string | null }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  return <div className="flex min-w-0 items-center gap-3">
    <span aria-hidden="true" className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-medium text-primary">
      {getInitials(name)}
      {photo && photo !== failedPhoto && <img src={photo} alt="" onError={() => setFailedPhoto(photo)} className="absolute inset-0 h-full w-full object-cover" />}
    </span>
    <div className="min-w-0 text-sm"><span className="text-muted-foreground">Skickas som</span><div className="break-words font-medium">{name}</div></div>
  </div>;
}
