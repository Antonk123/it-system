import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'dashboard-queues';

export interface DashboardQueue {
  id: string;           // unique queue ID (generated on add)
  filterViewId: string; // references a FilterView.id from useFilterViews
}

export function useDashboardQueues() {
  const [queues, setQueues] = useState<DashboardQueue[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queues));
  }, [queues]);

  const addQueue = useCallback((filterViewId: string) => {
    setQueues(prev => {
      // Don't add duplicate
      if (prev.some(q => q.filterViewId === filterViewId)) return prev;
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      return [...prev, { id, filterViewId }];
    });
  }, []);

  const removeQueue = useCallback((id: string) => {
    setQueues(prev => prev.filter(q => q.id !== id));
  }, []);

  const reorderQueues = useCallback((newOrder: DashboardQueue[]) => {
    setQueues(newOrder);
  }, []);

  const moveQueue = useCallback((id: string, direction: 'up' | 'down') => {
    setQueues(prev => {
      const index = prev.findIndex(q => q.id === id);
      if (index === -1) return prev;
      if (direction === 'up' && index === 0) return prev;
      if (direction === 'down' && index === prev.length - 1) return prev;
      const newQueues = [...prev];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newQueues[index], newQueues[swapIndex]] = [newQueues[swapIndex], newQueues[index]];
      return newQueues;
    });
  }, []);

  return { queues, addQueue, removeQueue, reorderQueues, moveQueue };
}
