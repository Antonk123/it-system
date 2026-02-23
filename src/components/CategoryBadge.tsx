import { Badge } from '@/components/ui/badge';
import { useCategories } from '@/hooks/useCategories';
import { Tag } from 'lucide-react';

interface CategoryBadgeProps {
  category?: string;
}

export const CategoryBadge = ({ category }: CategoryBadgeProps) => {
  const { getCategoryLabel } = useCategories();
  
  if (!category) return null;

  const label = getCategoryLabel(category);

  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <Tag className="w-3 h-3" />
      {label}
    </Badge>
  );
};
