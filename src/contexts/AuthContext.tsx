import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, AuthUser } from '@/lib/api';
import { clearRecentlyViewed } from '@/lib/recentlyViewed';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if we have a stored token and validate it
    const checkAuth = async () => {
      const token = localStorage.getItem('auth_token');
      
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const { user } = await api.getMe();
        setUser(user);
      } catch (error) {
        // Token is invalid, clear it
        api.logout();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { user } = await api.login(email, password);
      setUser(user);
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Login failed' };
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    clearRecentlyViewed();
    // Drop all cached server data so the next signed-in user never sees the
    // previous user's tickets/companies/etc. from a stale react-query cache.
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const value = useMemo(() => ({
    isAuthenticated: !!user,
    isLoading,
    user,
    signIn,
    signOut,
  }), [user, isLoading, signIn, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
