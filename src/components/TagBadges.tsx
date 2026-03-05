import { useNavigate } from 'react-router-dom';
import { Tag } from '@/types/ticket';

interface TagBadgesProps {
  tags?: Tag[];
  className?: string;
  maxDisplay?: number;
  clickable?: boolean;
}

export function TagBadges({
  tags = [],
  className = '',
  maxDisplay = 3,
  clickable = true
}: TagBadgesProps) {
  const navigate = useNavigate();

  if (tags.length === 0) {
    return null;
  }

  const visibleTags = tags.slice(0, maxDisplay);
  const hiddenCount = tags.length - maxDisplay;

  const handleTagClick = (e: React.MouseEvent, tagId: string) => {
    if (!clickable) return;
    e.preventDefault();
    e.stopPropagation();
    navigate(`/tickets?tags=${tagId}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent, tagId: string) => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      navigate(`/tickets?tags=${tagId}`);
    }
  };

  return (
    <div className={`flex gap-1 flex-wrap items-center ${className}`}>
      {visibleTags.map((tag) => (
        <span
          key={tag.id}
          style={{
            '--tag-color': tag.color
          } as React.CSSProperties}
          className={`
            px-2 py-1 rounded text-xs font-medium whitespace-nowrap
            border border-border transition-all duration-200
            text-foreground hover:text-white
            hover:bg-[var(--tag-color)] hover:border-[var(--tag-color)]
            ${clickable ? 'cursor-pointer' : ''}
          `}
          onClick={(e) => handleTagClick(e, tag.id)}
          onKeyDown={(e) => handleKeyDown(e, tag.id)}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-label={clickable ? `Filtrera på tagg ${tag.name}` : tag.name}
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
