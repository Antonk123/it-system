import { Tag } from '@/types/ticket';

interface TagBadgesProps {
  tags?: Tag[];
  className?: string;
  maxDisplay?: number;
}

export function TagBadges({ tags = [], className = '', maxDisplay = 3 }: TagBadgesProps) {
  if (tags.length === 0) {
    return null;
  }

  const visibleTags = tags.slice(0, maxDisplay);
  const hiddenCount = tags.length - maxDisplay;

  return (
    <div className={`flex gap-1 flex-wrap items-center ${className}`}>
      {visibleTags.map((tag) => (
        <span
          key={tag.id}
          style={{ backgroundColor: tag.color }}
          className="px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap"
        >
          {tag.name}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className="px-2 py-1 rounded text-xs font-medium bg-gray-300 text-gray-700 whitespace-nowrap">
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
