import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, LogIn, Ticket } from "lucide-react";
import { toast } from "sonner";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast.error(error);
    } else {
      toast.success("Inloggad");
      navigate("/");
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 relative overflow-hidden bg-[hsl(var(--search-input-bg))]">
      {/* Ambient glow orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-primary/8 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 rounded-full bg-accent/10 blur-[100px] pointer-events-none" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Glow behind card */}
        <div className="absolute -inset-1 rounded-2xl overflow-hidden blur-[3px] opacity-60 pointer-events-none">
          <div className="absolute w-[999px] h-[999px] bg-no-repeat top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                          bg-[conic-gradient(hsl(var(--search-glow-base)),hsl(var(--search-glow-primary-deep))_5%,hsl(var(--search-glow-base))_38%,hsl(var(--search-glow-base))_50%,hsl(var(--search-glow-accent-vivid))_60%,hsl(var(--search-glow-base))_87%)]
                          animate-glow-rotate" />
        </div>

        <div className="relative rounded-2xl border border-primary/20 bg-card/95 backdrop-blur-xl shadow-2xl shadow-primary/5 p-8 sm:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto w-16 h-16 rounded-2xl overflow-hidden mb-5 ring-1 ring-primary/20 shadow-lg shadow-primary/10">
              <img src="/icons/pfm-logo-lg.png" alt="PFM" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">IT-Ticket</h1>
            <p className="text-sm text-muted-foreground mt-1.5">Logga in för att fortsätta</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSignIn} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="signin-email">E-post</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input
                  id="signin-email"
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background/50"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signin-password">Lösenord</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input
                  id="signin-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-background/50"
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full h-11 text-sm font-semibold" disabled={isLoading}>
              <LogIn className="w-4 h-4 mr-2" />
              {isLoading ? "Loggar in..." : "Logga in"}
            </Button>
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Glömt lösenord?
              </Link>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground mb-2">Behöver du hjälp?</p>
            <Link
              to="/submit-ticket"
              className="inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium"
            >
              <Ticket className="w-4 h-4" />
              Skapa ärende
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
