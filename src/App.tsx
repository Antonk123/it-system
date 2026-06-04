import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { applyFontTheme, getStoredFontTheme, applyMode, getStoredMode } from "@/lib/appearance";
import ErrorBoundary from "@/components/ErrorBoundary";
import { lazy, Suspense, useEffect } from "react";

const Index = lazy(() => import("./pages/Index"));
const TicketList = lazy(() => import("./pages/TicketList"));
const TicketForm = lazy(() => import("./pages/TicketForm"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));
const Archive = lazy(() => import("./pages/Archive"));
const UserList = lazy(() => import("./pages/UserList"));
const Settings = lazy(() => import("./pages/Settings"));
const Reports = lazy(() => import("./pages/Reports"));
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const PublicTicketForm = lazy(() => import("./pages/PublicTicketForm"));
const SharedTicket = lazy(() => import("./pages/SharedTicket"));
const NotFound = lazy(() => import("./pages/NotFound"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const KBArticleDetail = lazy(() => import("./pages/KBArticleDetail"));
const KBArticleForm = lazy(() => import("./pages/KBArticleForm"));
const SharedKBArticle = lazy(() => import("./pages/SharedKBArticle"));
const Recurring = lazy(() => import("./pages/Recurring"));
const CompanyList = lazy(() => import("./pages/CompanyList"));
const CompanyDetail = lazy(() => import("./pages/CompanyDetail"));
const Invoices = lazy(() => import("./pages/Invoices"));

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
    applyMode(getStoredMode());
    // Migrate users who had daylight selected — fall back to default
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'theme-daylight') {
      localStorage.setItem('theme', 'theme-default');
      document.documentElement.classList.remove('theme-daylight');
      document.documentElement.classList.add('theme-default');
    }
  }, []);

  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
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
      <div className="min-h-dvh flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
};

const RouteFallback = () => (
  <div className="min-h-dvh flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

/** Scrollar till toppen vid framåtnavigering (PUSH/REPLACE).
 *  Vid back/forward (POP) låter vi browsern hantera scroll-position. */
const ScrollToTopOnNavigate = () => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [pathname, navigationType]);
  return null;
};

const AppRoutes = () => {
  const location = useLocation();
  return (
    <Suspense fallback={<RouteFallback />}>
      <ScrollToTopOnNavigate />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
          <Route path="/reset-password/:token" element={<PublicRoute><ResetPassword /></PublicRoute>} />
          <Route path="/submit-ticket" element={<PublicTicketForm />} />
          <Route path="/shared/:token" element={<SharedTicket />} />
          <Route path="/kb/shared/:token" element={<SharedKBArticle />} />
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/tickets" element={<ProtectedRoute><TicketList /></ProtectedRoute>} />
          <Route path="/my-tickets" element={<ProtectedRoute><TicketList /></ProtectedRoute>} />
          <Route path="/tickets/new" element={<ProtectedRoute><TicketForm /></ProtectedRoute>} />
          <Route path="/tickets/:id" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />
          <Route path="/tickets/:id/edit" element={<ProtectedRoute><TicketForm /></ProtectedRoute>} />
          <Route path="/recurring" element={<ProtectedRoute><Recurring /></ProtectedRoute>} />
          <Route path="/companies" element={<ProtectedRoute><CompanyList /></ProtectedRoute>} />
          <Route path="/companies/:id" element={<ProtectedRoute><CompanyDetail /></ProtectedRoute>} />
          <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
          <Route path="/archive" element={<ProtectedRoute><Archive /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute><UserList /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/kb" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} />
          <Route path="/kb/new" element={<ProtectedRoute><KBArticleForm /></ProtectedRoute>} />
          <Route path="/kb/:id" element={<ProtectedRoute><KBArticleDetail /></ProtectedRoute>} />
          <Route path="/kb/:id/edit" element={<ProtectedRoute><KBArticleForm /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="theme-stone"
        enableSystem={false}
        themes={["theme-default", "theme-midnight", "theme-graphite", "theme-stone", "theme-linear", "theme-spotify"]}
      >
        <AppearanceInitializer />
        <TooltipProvider>
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
