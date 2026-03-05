import { useState, useEffect } from 'react';

export type ReportModuleId =
  | 'requesterAnalytics'
  | 'statusDistribution'
  | 'priorityChart'
  | 'monthlyChart'
  | 'activityHeatmap'
  | 'statusFlow'
  | 'tagAnalytics';

export interface ReportModule {
  id: ReportModuleId;
  label: string;
  description: string;
  visible: boolean;
}

export interface ReportsPreferences {
  modules: ReportModule[];
}

const DEFAULT_MODULES: ReportModule[] = [
  {
    id: 'requesterAnalytics',
    label: 'Requester Analytics',
    description: 'Ticket distribution by requester',
    visible: true,
  },
  {
    id: 'statusDistribution',
    label: 'Ärenden per status',
    description: 'Status distribution rings',
    visible: true,
  },
  {
    id: 'priorityChart',
    label: 'Priority Distribution',
    description: 'Tickets by priority level',
    visible: true,
  },
  {
    id: 'monthlyChart',
    label: 'Monthly Tickets',
    description: 'Tickets closed per month',
    visible: true,
  },
  {
    id: 'activityHeatmap',
    label: 'Activity Calendar',
    description: 'Daily ticket creation heatmap',
    visible: true,
  },
  {
    id: 'statusFlow',
    label: 'Status Flow Over Time',
    description: 'Historical status trends',
    visible: true,
  },
  {
    id: 'tagAnalytics',
    label: 'Tag Analytics',
    description: 'Tag usage statistics',
    visible: true,
  },
];

const STORAGE_KEY = 'reports-preferences';

export const useReportsPreferences = () => {
  const [preferences, setPreferences] = useState<ReportsPreferences>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new modules
        const existingIds = new Set(parsed.modules?.map((m: ReportModule) => m.id) || []);
        const mergedModules = [
          ...(parsed.modules || []),
          ...DEFAULT_MODULES.filter(m => !existingIds.has(m.id)),
        ];
        return { modules: mergedModules };
      }
    } catch (error) {
      console.error('Failed to load reports preferences:', error);
    }
    return { modules: DEFAULT_MODULES };
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save reports preferences:', error);
    }
  }, [preferences]);

  const toggleModule = (id: ReportModuleId) => {
    setPreferences(prev => ({
      modules: prev.modules.map(m =>
        m.id === id ? { ...m, visible: !m.visible } : m
      ),
    }));
  };

  const moveModule = (id: ReportModuleId, direction: 'up' | 'down') => {
    setPreferences(prev => {
      const modules = [...prev.modules];
      const index = modules.findIndex(m => m.id === id);

      if (index === -1) return prev;

      const newIndex = direction === 'up' ? index - 1 : index + 1;

      if (newIndex < 0 || newIndex >= modules.length) return prev;

      // Swap positions
      [modules[index], modules[newIndex]] = [modules[newIndex], modules[index]];

      return { modules };
    });
  };

  const resetPreferences = () => {
    setPreferences({ modules: DEFAULT_MODULES });
  };

  const toggleAll = (visible: boolean) => {
    setPreferences(prev => ({
      modules: prev.modules.map(m => ({ ...m, visible })),
    }));
  };

  const getVisibleModules = () => {
    return preferences.modules.filter(m => m.visible);
  };

  return {
    preferences,
    toggleModule,
    moveModule,
    resetPreferences,
    toggleAll,
    getVisibleModules,
  };
};
