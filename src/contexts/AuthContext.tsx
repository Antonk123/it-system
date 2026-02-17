import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, AuthUser } from '@/lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
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

  const signIn = async (email: string, password: string) => {
    try {
      const { user } = await api.login(email, password);
      setUser(user);
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Login failed' };
    }
  };

  const signOut = async () => {
    api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated: !!user, 
      isLoading,
      user,
      signIn, 
      signOut 
    }}>
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
