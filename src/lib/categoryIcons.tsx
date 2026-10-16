/* eslint-disable react-refresh/only-export-components -- data + helpers live beside the icon components by design */
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Hue = 'neutral' | 'blue' | 'green' | 'purple' | 'orange' | 'amber' | 'teal' | 'pink';

interface CategoryIconDef {
  key: string;
  label: string;
  hue: Hue;
  path: string;
}

/** Navets 17 verktygsikoner (formgivna av Markus Perlskog). */
export const CATEGORY_ICONS = [
  { key: 'default', label: 'Standard', hue: 'neutral', path: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2' },
  { key: 'document', label: 'Dokument', hue: 'blue', path: 'M14 2H6v20h12V6l-4-4Z M14 2v5h4M9 12h6M9 16h6' },
  { key: 'spreadsheet', label: 'Kalkylblad', hue: 'green', path: 'M4 3h16v18H4ZM4 9h16M4 15h16M10 9v12' },
  { key: 'people', label: 'Personer', hue: 'purple', path: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 3a4 4 0 0 1 0 8' },
  { key: 'project', label: 'Projekt', hue: 'blue', path: 'M3 3h18v18H3ZM8 7v10M12 7v6M16 7v8' },
  { key: 'production', label: 'Produktion', hue: 'orange', path: 'M3 21V9l6 4V9l6 4V3h4l2 18ZM7 17h1M12 17h1M17 17h1' },
  { key: 'chart', label: 'Diagram', hue: 'amber', path: 'M4 20h16M6 16v-5M12 16V4M18 16V8' },
  { key: 'finance', label: 'Ekonomi', hue: 'green', path: 'M3 5h18v14H3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M6 12h.01M18 12h.01' },
  { key: 'safety', label: 'Säkerhet', hue: 'amber', path: 'M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6ZM8 12l3 3 5-6' },
  { key: 'quality', label: 'Kvalitet', hue: 'purple', path: 'M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M8 16l-1 6 5-3 5 3-1-6M9 10l2 2 4-4' },
  { key: 'calendar', label: 'Kalender', hue: 'blue', path: 'M3 5h18v16H3ZM7 3v4M17 3v4M3 10h18M7 14h2M13 14h2M7 18h2' },
  { key: 'time', label: 'Tid', hue: 'teal', path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2' },
  { key: 'checklist', label: 'Checklista', hue: 'green', path: 'M3 6l2 2 3-4M11 6h10M3 13l2 2 3-4M11 13h10M3 20l2 2 3-4M11 20h10' },
  { key: 'folder', label: 'Mapp', hue: 'amber', path: 'M3 5h7l2 3h9v13H3Z' },
  { key: 'support', label: 'Support', hue: 'pink', path: 'M3 14v-2a9 9 0 0 1 18 0v2M3 12h4v7H3ZM17 12h4v7h-4ZM21 19v3h-7' },
  { key: 'education', label: 'Utbildning', hue: 'purple', path: 'M2 9l10-6 10 6-10 6ZM6 12v6l6 3 6-3v-6M22 9v8' },
  { key: 'grid', label: 'Rutnät', hue: 'teal', path: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7h-7ZM14 14h7v7h-7Z' },
] as const satisfies readonly CategoryIconDef[];

export type CategoryIconKey = (typeof CATEGORY_ICONS)[number]['key'];

export const isCategoryIconKey = (value: unknown): value is CategoryIconKey =>
  typeof value === 'string' && CATEGORY_ICONS.some((i) => i.key === value);

const findIcon = (key: string | null | undefined) =>
  isCategoryIconKey(key) ? CATEGORY_ICONS.find((i) => i.key === key) : undefined;

const hueVar = (hue: Hue) => `var(--hue-${hue})`;

interface CategoryIconProps {
  icon?: string | null;
  variant?: 'inline' | 'tile';
  className?: string;
}

const Glyph = ({ path, className, style }: { path: string; className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
    style={style}
  >
    <path d={path} />
  </svg>
);

/** Renders a category icon, or null for a missing/unknown key (callers keep their fallback). */
export const CategoryIcon = ({ icon, variant = 'inline', className }: CategoryIconProps) => {
  const def = findIcon(icon);
  if (!def) return null;
  const neutral = def.hue === 'neutral';

  if (variant === 'tile') {
    const color = neutral ? 'hsl(var(--muted-foreground))' : hueVar(def.hue);
    const tint = neutral
      ? 'color-mix(in srgb, hsl(var(--muted-foreground)) 5%, hsl(var(--card)))'
      : `color-mix(in srgb, ${hueVar(def.hue)} 12%, hsl(var(--card)))`;
    return (
      <span
        aria-hidden="true"
        className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', className)}
        style={{ background: tint, color }}
      >
        <Glyph path={def.path} className="h-4 w-4" />
      </span>
    );
  }

  return (
    <Glyph
      path={def.path}
      className={cn('h-3.5 w-3.5 shrink-0', neutral && 'text-muted-foreground', className)}
      style={neutral ? undefined : { color: hueVar(def.hue) }}
    />
  );
};

const NONE = '__none';

interface CategoryIconPickerProps {
  value?: string | null;
  onChange: (key: string | null) => void;
  id?: string;
  className?: string;
  label?: string;
}

export const CategoryIconPicker = ({ value, onChange, id, className, label = 'Kategoriikon' }: CategoryIconPickerProps) => {
  const current = isCategoryIconKey(value) ? value : NONE;
  return (
    <Select value={current} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} aria-label={label} className={cn('w-[11rem] shrink-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Ingen ikon</SelectItem>
        {CATEGORY_ICONS.map((i) => (
          <SelectItem key={i.key} value={i.key}>
            <span className="flex items-center gap-2">
              <CategoryIcon icon={i.key} />
              {i.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
