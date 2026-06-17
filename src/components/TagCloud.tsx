import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TagAnalyticsRow } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TagCloudProps {
  // Pre-counted tag frequencies from the server (/reports/tag-analytics).
  tags: TagAnalyticsRow[];
  onTagClick?: (tagId: string) => void;
  className?: string;
}

interface TagCloudData {
  tag: TagAnalyticsRow;
  count: number;
  sizeLevel: 1 | 2 | 3 | 4 | 5;
}

export const TagCloud = ({
  tags,
  onTagClick,
  className,
}: TagCloudProps) => {
  const navigate = useNavigate();
  const [hoveredTag, setHoveredTag] = useState<TagCloudData | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Derive size levels from the server-supplied counts.
  const tagCloudData = useMemo(() => {
    const max = Math.max(...tags.map(t => t.count), 1);

    return tags
      .map(tag => {
        const count = tag.count;
        // Calculate size level based on percentage of max
        const percentage = count / max;
        let sizeLevel: 1 | 2 | 3 | 4 | 5;
        if (percentage >= 0.8) sizeLevel = 5;
        else if (percentage >= 0.6) sizeLevel = 4;
        else if (percentage >= 0.4) sizeLevel = 3;
        else if (percentage >= 0.2) sizeLevel = 2;
        else sizeLevel = 1;

        return { tag, count, sizeLevel };
      })
      .sort((a, b) => b.count - a.count);
  }, [tags]);

  // Get text size class based on size level
  const getSizeClass = (level: 1 | 2 | 3 | 4 | 5) => {
    switch (level) {
      case 1: return 'text-sm';
      case 2: return 'text-base';
      case 3: return 'text-lg';
      case 4: return 'text-xl';
      case 5: return 'text-2xl';
      default: return 'text-base';
    }
  };

  // Handle tag click
  const handleTagClick = (tagData: TagCloudData) => {
    if (onTagClick) {
      onTagClick(tagData.tag.id);
    } else {
      navigate(`/tickets?tags=${tagData.tag.id}`);
    }
  };

  // Handle mouse enter
  const handleMouseEnter = (tagData: TagCloudData, event: React.MouseEvent) => {
    setHoveredTag(tagData);
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  };

  // Handle mouse leave
  const handleMouseLeave = () => {
    setHoveredTag(null);
  };

  if (tagCloudData.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-64 text-muted-foreground', className)}>
        Inga taggar tillgängliga
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <div className="flex flex-wrap gap-3 items-center justify-center p-6">
        {tagCloudData.map((tagData) => (
          <button
            key={tagData.tag.id}
            onClick={() => handleTagClick(tagData)}
            onMouseEnter={(e) => handleMouseEnter(tagData, e)}
            onMouseLeave={handleMouseLeave}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold',
              'transition-all duration-300 hover:scale-110 hover:shadow-lg',
              'cursor-pointer',
              getSizeClass(tagData.sizeLevel)
            )}
            style={{
              backgroundColor: `${tagData.tag.color}20`,
              color: tagData.tag.color,
              borderColor: tagData.tag.color,
              borderWidth: '2px',
            }}
          >
            <span>{tagData.tag.name}</span>
            <span
              className="font-mono text-xs opacity-70"
              style={{ fontSize: `${10 + tagData.sizeLevel}px` }}
            >
              {tagData.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tooltip */}
      {hoveredTag && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-popover text-popover-foreground px-4 py-2 rounded-lg shadow-lg border whitespace-nowrap">
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: hoveredTag.tag.color }}
              />
              <span className="font-semibold">{hoveredTag.tag.name}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {hoveredTag.count} {hoveredTag.count === 1 ? 'ärende' : 'ärenden'}
            </div>
            <div className="text-xs text-muted-foreground mt-1 italic">
              Klicka för att filtrera
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
