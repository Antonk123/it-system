import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, AuthUser } from '@/lib/api';
import { clearRecentlyViewed } from '@/lib/recentlyViewed';
import { safeStorage } from '@/lib/safeStorage';
import { clearSecureAttachmentCache } from '@/lib/secureFileAccess';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  completeSsoLogin: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Servern har avvisat sessionen (till skillnad från nätverks-/serverfel, där
// token ska behållas så att en tillfällig störning inte loggar ut någon).
const isAuthRejection = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Återställ sessionen: lagrad access-token, annars refresh-cookien (token kan
    // saknas fast sessionen lever, t.ex. om localStorage rensats eller är blockerad).
    const checkAuth = async () => {
      try {
        if (!safeStorage.getItem('auth_token') && !(await api.refreshSession())) {
          return;
        }
        const { user } = await api.getMe();
        setUser(user);
      } catch (error) {
        if (isAuthRejection(error)) {
          api.clearToken();
        } else {
          toast.error('Kunde inte kontrollera inloggningen. Ladda om sidan.');
        }
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
      return { error: error instanceof Error ? error.message : 'Inloggningen misslyckades' };
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    clearRecentlyViewed();
    clearSecureAttachmentCache();
    // Drop all cached server data so the next signed-in user never sees the
    // previous user's tickets/companies/etc. from a stale react-query cache.
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  // Efter OIDC-callbacken finns refresh-cookien men ingen access-token —
  // hämta token + user utan full sidomladdning.
  const completeSsoLogin = useCallback(async (): Promise<boolean> => {
    try {
      if (!(await api.refreshSession())) return false;
      const { user } = await api.getMe();
      setUser(user);
      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const { user } = await api.getMe();
    setUser(user);
  }, []);

  const value = useMemo(() => ({
    isAuthenticated: !!user,
    isLoading,
    user,
    signIn,
    signOut,
    completeSsoLogin,
    refreshUser,
  }), [user, isLoading, signIn, signOut, completeSsoLogin, refreshUser]);

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
