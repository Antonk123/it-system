export const AVATAR_COLORS = [
  'bg-linear-to-br from-purple-500 to-pink-500',
  'bg-linear-to-br from-blue-500 to-cyan-500',
  'bg-linear-to-br from-orange-500 to-red-500',
  'bg-linear-to-br from-green-500 to-teal-500',
];

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
