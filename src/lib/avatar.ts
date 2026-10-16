// Bibliotek: en enda avatar-gradient, accent → accent-2 (som i Prefabnavet).
export const AVATAR_GRADIENT = 'bg-linear-to-br from-primary to-accent-2 text-primary-foreground';

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
