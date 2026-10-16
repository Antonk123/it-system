import { useLocation } from "react-router";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="module-h1 mb-4">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Sidan kunde inte hittas</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Tillbaka till start
        </a>
      </div>
    </div>
  );
};

export default NotFound;
