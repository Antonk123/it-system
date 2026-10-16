// Statusfärger för diagram. Grannserier i staplade diagram ska skilja sig i
// ljushet, inte bara nyans — i Bibliotek ligger chart-1 och chart-2 för nära
// varandra, så varje status får sin egen semantiska hue.
export const STATUS_CHART_COLORS = {
  open: 'hsl(var(--chart-4))', // skifferblå
  'in-progress': 'hsl(var(--chart-5))', // bärnsten
  waiting: 'hsl(var(--chart-1))', // oxblod / tan
  resolved: 'hsl(var(--chart-3))', // grön
  closed: 'hsl(var(--muted-foreground))',
} as const;
