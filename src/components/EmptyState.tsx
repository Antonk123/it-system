import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Optional icon shown above the title (typically a lucide icon at ~48px) */
  icon?: ReactNode;
  /** Main heading text */
  title: string;
  /** Optional supporting description */
  description?: string;
  /** When true and onClearFilters is provided, renders a "Rensa filter" button */
  hasFilters?: boolean;
  /** Callback for the "Rensa filter" button */
  onClearFilters?: () => void;
  /** Optional extra action element (e.g. a "Skapa ny" CTA) rendered after the clear-filters button */
  action?: ReactNode;
  /** Extra classes applied to the outer container */
  className?: string;
}

/**
 * Reusable empty-state block for list-style pages.
 *
 * - Renders a centered card with optional icon, title, description, and actions.
 * - Pass `hasFilters` + `onClearFilters` to expose a "Rensa filter" button when the
 *   list is empty because of active filters (vs. empty in general).
 * - Pass `action` to add a CTA (e.g. "Skapa nytt företag") for the truly-empty case.
 */
export const EmptyState = ({
  icon,
  title,
  description,
  hasFilters,
  onClearFilters,
  action,
  className,
}: EmptyStateProps) => {
  const showClearFilters = hasFilters && typeof onClearFilters === 'function';

  return (
    <div
      className={cn(
        'text-center py-16 px-6 border rounded-lg bg-card flex flex-col items-center',
        className,
      )}
    >
      {icon && (
        <div className="text-muted-foreground mb-4 [&_svg]:w-12 [&_svg]:h-12 [&_svg]:mx-auto">
          {icon}
        </div>
      )}
      <p className="text-foreground font-semibold">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>
      )}
      {(showClearFilters || action) && (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
          {showClearFilters && (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Rensa filter
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
