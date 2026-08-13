import { useState, useEffect, useRef } from "react";
import { useNavigate, Link, useSearchParams, useLocation } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { sanitizeReturnTo } from "@/lib/returnTo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, LogIn, Ticket } from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

const SSO_ERROR_MESSAGES: Record<string, string> = {
  unknown_user: "Ditt konto finns inte i IT-Ticket — kontakta administratören.",
  failed: "SSO-inloggningen misslyckades. Försök igen eller logga in med lösenord.",
};

// sso_error-koden kommer rakt från query-strängen och är alltså helt besökarstyrd.
// En vanlig uppslagning (SSO_ERROR_MESSAGES[code] ?? fallback) når även
// Object.prototype: ?sso_error=constructor / =toString / =valueOf ger då en
// FUNKTION, som ?? inte fångar eftersom den varken är null eller undefined.
// Värdet hamnar sedan i en state-setter, och React tolkar ett funktionsargument
// som en updater — den anropas med föregående state och resultatet renderas, så
// hela login-sidan kraschar ("Objects are not valid as a React child") i stället
// för att visa det generiska felet. Därför slår vi bara upp EGNA nycklar.
const resolveSsoErrorMessage = (code: string): string =>
  Object.hasOwn(SSO_ERROR_MESSAGES, code) ? SSO_ERROR_MESSAGES[code] : SSO_ERROR_MESSAGES.failed;

// Microsofts fyrfärgsmärke — inline SVG (appens CSP laddar inga tredjeparts-
// resurser). Färgerna är varumärkesbundna och får ALDRIG ärva currentColor,
// därför fill sätts direkt per ruta i stället för via CSS/valfri klass.
// Dekorativ: knappens text bär redan betydelsen ("Logga in med <provider>"),
// så aria-hidden + focusable="false" håller den borta ur tillgänglighetsträdet.
// Microsofts fyrfärgsmärke. Storleken sätts av Button-varianten ([&_svg]:size-4
// → 16px), inte här: egna width/height-attribut hade sett ut att styra men
// överskrivs av den regeln, dvs. dött kodintent. Kontrasten mot en ljus
// outline-knapp är låg för grön/blå/gul (1,7–2,7:1), men märket är dekorativt
// och aria-hidden — formellt undantaget WCAG 1.4.11 — och färgerna är
// varumärkeslåsta. Så ser Microsofts egen knapp ut överallt.
const MicrosoftLogo = () => (
  <svg
    viewBox="0 0 21 21"
    aria-hidden="true"
    focusable="false"
    className="shrink-0"
  >
    {/* Rutor 10x10 med 1 enhets gap fyller viewBoxen exakt (0..21) och matchar
        Microsofts egna proportioner (gap = 1/10 av rutan). Färgerna är deras
        fastställda värden och får aldrig ärva currentColor eller färgas om. */}
    <rect x="0" y="0" width="10" height="10" fill="#F25022" />
    <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
    <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
    <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
  </svg>
);

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { signIn, completeSsoLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sso, setSso] = useState<{ enabled: boolean; label: string | null; provider: 'microsoft' | null }>({
    enabled: false,
    label: null,
    provider: null,
  });
  // Felmeddelandet lever i state, inte i URL:en. ?sso_error= rensas bort så snart
  // det lästs (se callback-effekten nedan) — annars återuppväcker en reload eller
  // en bokmärkt /login?sso_error=... ett för länge sedan inaktuellt fel.
  const [ssoErrorMessage, setSsoErrorMessage] = useState<string | null>(null);
  // Dedup-guard: StrictMode (dev) dubbel-invokerar effekter — utan guard skulle
  // två nära-samtidiga POST /auth/refresh race:a mot den roterande refresh-tokenen.
  const ssoHandled = useRef(false);

  useEffect(() => {
    api.getOidcStatus().then(setSso).catch(() => setSso({ enabled: false, label: null, provider: null }));
  }, []);

  // Hanterar returen från backendens OIDC-callback: den redirectar hit med
  // antingen ?sso=1 (lyckad) eller ?sso_error=<kod> (misslyckad).
  useEffect(() => {
    const errorCode = searchParams.get("sso_error");
    const isSsoCallback = searchParams.get("sso") === "1";
    if (errorCode === null && !isSsoCallback) return;

    if (errorCode !== null) setSsoErrorMessage(resolveSsoErrorMessage(errorCode));

    // Rensa BÅDA parametrarna i EN enda uppdatering: react-router bygger inte
    // vidare på föregående värde när setSearchParams anropas flera gånger i
    // samma tick, så två separata anrop skulle skriva tillbaka varandras param.
    // replace, eftersom städningen inte ska lägga en extra post i historiken.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("sso");
        next.delete("sso_error");
        return next;
      },
      { replace: true }
    );

    if (!isSsoCallback || ssoHandled.current) return;
    ssoHandled.current = true;
    completeSsoLogin().then((ok) => {
      if (ok) {
        toast.success("Inloggad");
        // SSO landar ALLTID på "/" — medvetet val: backendens OIDC-callback bär
        // inte med returnTo genom redirect-kedjan, så det finns ingen sparad
        // plats att återvända till. replace krävs för att bakåtknappen inte ska
        // leda tillbaka till /login?sso=1, vars nya mount annars skulle köra hela
        // completion-flödet en gång till mot en redan förbrukad refresh-token.
        navigate("/", { replace: true });
      } else {
        // Toasten försvinner efter ~4 sekunder och annonseras bara i förbifarten.
        // Backend-felet (?sso_error=) ger däremot ett KVARSTÅENDE role="alert" —
        // utan samma behandling här får en skärmläsaranvändare som missar toasten
        // aldrig veta varför inloggningen uteblev, bara att den inte hände.
        // Toasten behålls för seende (fångar blicken direkt), meddelandet är för
        // alla som behöver kunna gå tillbaka och läsa orsaken.
        setSsoErrorMessage(SSO_ERROR_MESSAGES.failed);
        toast.error(SSO_ERROR_MESSAGES.failed);
      }
    });
  }, [searchParams, setSearchParams, completeSsoLogin, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast.error(error);
    } else {
      toast.success("Inloggad");
      // Prioritet: router-state (guard-redirect/manuell logout) → ?returnTo=
      // (hård 401-redirect) → "/" som fallback. sanitizeReturnTo stänger open-
      // redirect-hålet (icke-intern path, eller peka tillbaka mot /login).
      const target = sanitizeReturnTo((location.state as { from?: unknown } | null)?.from ?? searchParams.get("returnTo"));
      navigate(target, { replace: true });
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 relative overflow-hidden bg-[hsl(var(--search-input-bg))]">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative w-full max-w-md">
        <div className="relative rounded-2xl border border-primary/20 bg-card/95 backdrop-blur-xl shadow-2xl shadow-primary/5 p-8 sm:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto w-16 h-16 rounded-2xl overflow-hidden mb-5 ring-1 ring-primary/20 shadow-lg shadow-primary/10">
              {/* Dekorativ (alt=""): rubriken "IT-Ticket" direkt under förmedlar redan namnet */}
              <BrandLogo alt="" className="w-full h-full object-cover" />
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

          {sso.enabled && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">eller</span>
                </div>
              </div>
              {/* MÅSTE vara ett <a> (vanlig navigering), aldrig ett <form> som
                  postar till backend: CSP:ns form-action 'self' (nginx.conf +
                  helmets default) blockerar en formulärsubmit så snart
                  redirect-kedjan lämnar vår egen origin på väg mot Entra. */}
              <Button asChild variant="outline" className="w-full">
                {/* Andra försvarslinjen mot en tom/whitespace-label (getOidcStatus
                    trimmar redan bort den): en länk utan textinnehåll får inget
                    tillgängligt namn alls och blir omöjlig att identifiera för
                    skärmläsare. ?? räcker inte — "" och "   " är inte null. */}
                <a href={api.oidcLoginUrl()} className="inline-flex items-center justify-center gap-2">
                  {sso.provider === "microsoft" && <MicrosoftLogo />}
                  {sso.label?.trim() || "Logga in med SSO"}
                </a>
              </Button>
            </>
          )}
          {/* Live-regionen renderas ALLTID, inte bara när felet finns. En
              role="alert" som monteras in i DOM:en i samma ögonblick som texten
              sätts annonseras opålitligt (flera skärmläsare/browser-kombinationer
              hinner inte uppfatta den nya regionen) — regionen ska finnas i
              tillgänglighetsträdet i förväg och bara FYLLAS. Marginalen villkoras
              så att den tomma regionen inte lägger till luft i layouten. */}
          <p role="alert" className={cn("text-sm text-destructive text-center", ssoErrorMessage && "mt-4")}>
            {ssoErrorMessage}
          </p>

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
