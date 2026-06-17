import { useQuery } from '@tanstack/react-query';
import { api, TagAnalyticsRow } from '@/lib/api';

export const tagAnalyticsKeys = {
  all: ['reports', 'tag-analytics'] as const,
};

// Server-side tag-frequency counts (replaces client-side tag counting that
// silently undercounted past the 1000-row ticket cap).
export const useTagAnalytics = () => {
  return useQuery<TagAnalyticsRow[]>({
    queryKey: tagAnalyticsKeys.all,
    queryFn: () => api.getTagAnalytics(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
