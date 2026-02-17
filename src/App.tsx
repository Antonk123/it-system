import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import Index from "./pages/Index";
import TicketList from "./pages/TicketList";
import TicketForm from "./pages/TicketForm";
import TicketDetail from "./pages/TicketDetail";
import Archive from "./pages/Archive";
import UserList from "./pages/UserList";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import PublicTicketForm from "./pages/PublicTicketForm";
import SharedTicket from "./pages/SharedTicket";
import NotFound from "./pages/NotFound";
import { applyFontTheme, getStoredFontTheme } from "@/lib/appearance";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
      refetchOnWindowFocus: false, // Don't refetch on window focus
      retry: 1, // Retry failed requests once
    },
    mutations: {
      retry: 1, // Retry failed mutations once
    },
  },
});

const AppearanceInitializer = () => {
  useEffect(() => {
    applyFontTheme(getStoredFontTheme());
  }, []);

  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/submit-ticket" element={<PublicTicketForm />} />
    <Route path="/shared/:token" element={<SharedTicket />} />
    <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
    <Route path="/tickets" element={<ProtectedRoute><TicketList /></ProtectedRoute>} />
    <Route path="/tickets/new" element={<ProtectedRoute><TicketForm /></ProtectedRoute>} />
    <Route path="/tickets/:id" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />
    <Route path="/tickets/:id/edit" element={<ProtectedRoute><TicketForm /></ProtectedRoute>} />
    <Route path="/archive" element={<ProtectedRoute><Archive /></ProtectedRoute>} />
    <Route path="/users" element={<ProtectedRoute><UserList /></ProtectedRoute>} />
    <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider
      attribute="class"
      defaultTheme="theme-midnight"
      enableSystem={false}
      themes={["theme-midnight", "theme-default", "theme-slate", "theme-forest"]}
    >
      <AppearanceInitializer />
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
