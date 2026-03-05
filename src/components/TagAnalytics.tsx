import { Ticket, Tag } from '@/types/ticket';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { TagCloud } from '@/components/TagCloud';
import { TagDistributionChart } from '@/components/TagDistributionChart';
import { cn } from '@/lib/utils';

interface TagAnalyticsProps {
  tickets: Ticket[];
  tags: Tag[];
  onTagClick?: (tagId: string) => void;
  className?: string;
}

export const TagAnalytics = ({
  tickets,
  tags,
  onTagClick,
  className,
}: TagAnalyticsProps) => {
  // Check if there are any tags
  const hasTags = tags.length > 0 && tickets.some(t => t.tags && t.tags.length > 0);

  if (!hasTags) {
    return (
      <div className={cn('grid gap-6', className)}>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold font-serif">
              Tag Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No tag data available. Start adding tags to tickets to see analytics.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn('grid gap-6 lg:grid-cols-2', className)}>
      {/* Tag Cloud */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold font-serif">
            Tag Cloud
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Tag size reflects usage frequency
          </p>
        </CardHeader>
        <CardContent>
          <TagCloud
            tickets={tickets}
            tags={tags}
            onTagClick={onTagClick}
          />
        </CardContent>
      </Card>

      {/* Tag Distribution Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold font-serif">
            Top Tags
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Most frequently used tags
          </p>
        </CardHeader>
        <CardContent>
          <TagDistributionChart
            tickets={tickets}
            tags={tags}
            onTagClick={onTagClick}
            topN={10}
          />
        </CardContent>
      </Card>
    </div>
  );
};
