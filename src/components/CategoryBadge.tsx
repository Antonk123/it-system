import { useNavigate, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { useCategories } from '@/hooks/useCategories';
import { Tag } from 'lucide-react';

interface CategoryBadgeProps {
  category?: string;
  clickable?: boolean;
}

export const CategoryBadge = ({ category, clickable = true }: CategoryBadgeProps) => {
  const { getCategoryLabel } = useCategories();
  const navigate = useNavigate();
  const location = useLocation();

  if (!category) return null;

  const label = getCategoryLabel(category);

  const handleClick = (e: React.MouseEvent) => {
    if (!clickable) return;
    e.preventDefault();
    e.stopPropagation();

    // Navigate to current path with category filter
    const basePath = location.pathname;
    navigate(`${basePath}?category=${category}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();

      // Navigate to current path with category filter
      const basePath = location.pathname;
      navigate(`${basePath}?category=${category}`);
    }
  };

  return (
    <Badge
      variant="outline"
      className={`gap-1 font-normal ${
        clickable ? 'cursor-pointer hover:bg-accent transition-colors' : ''
      }`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Filtrera på kategori ${label}` : label}
    >
      <Tag className="w-3 h-3" />
      {label}
    </Badge>
  );
};
