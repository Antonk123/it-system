import { useConfirmDiscard } from "@/hooks/useConfirmDiscard";
import { useEffect, useState, useRef } from "react";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import { FileUpload } from "@/components/FileUpload";
import { api, downloadBlob, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PublicTicketForm } from "./PublicTicketForm";
import {
  useSupportProfile,
  type SupportProfile,
} from "@/hooks/useSupportProfile";
interface Summary {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}
interface Detail extends Summary {
  description: string;
  comments: {
    id: string;
    author: string;
    content: string;
    created_at: string;
  }[];
  attachments: {
    id: string;
    file_name: string;
    file_size: number;
  }[];
}
interface Session {
  subject: string;
  token: string;
  profile: SupportProfile;
}
const labels: Record<string, string> = {
  open: "Mottaget",
  "in-progress": "Pågår",
  resolved: "Löst",
  waiting: "Väntar",
  closed: "Avslutat",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
const parentOrigins = [
  "https://navet.prefabmastarna.se",
  "https://navet-dev.prefabmastarna.se",
  ...(import.meta.env.DEV
    ? ["http://localhost:8000", "http://127.0.0.1:8000"]
    : []),
];
export default function SelfService() {
  const visualProfile = useSupportProfile(true);
  const identityRef = useRef<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmDiscard();
  const [session, setSession] = useState<Session | null>(null),
    [view, setView] = useState<"new" | "list" | "detail" | "confirm">("new");
  const [state, setState] = useState("open"),
    [page, setPage] = useState(1),
    [list, setList] = useState<Summary[]>([]),
    [total, setTotal] = useState(0),
    [detail, setDetail] = useState<Detail | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reply, setReply] = useState(""),
    [sent, setSent] = useState(false),
    [created, setCreated] = useState("");
  const lock = useRef(false),
    replyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        !parentOrigins.includes(event.origin) ||
        event.data?.type !== "prefabnavet.support-session" ||
        event.data.version !== 1
      )
        return;
      if (
        typeof event.data.subject !== "string" ||
        typeof event.data.token !== "string" ||
        event.data.token.length > 4096 ||
        typeof event.data.name !== "string" ||
        typeof event.data.email !== "string"
      )
        return;
      clearTimeout(timeout);
      if (
        identityRef.current !== null &&
        identityRef.current !== event.data.subject
      ) {
        setList([]);
        setDetail(null);
        setReply("");
        setFiles([]);
        setCreated("");
        setPage(1);
        setTotal(0);
        setSent(false);
        replyKey.current = crypto.randomUUID();
        setView("new");
      }
      identityRef.current = event.data.subject;
      setSession({
        subject: event.data.subject,
        token: event.data.token,
        profile: {
          name: event.data.name,
          email: event.data.email,
          photo: null,
        },
      });
      setError("");
    };
    const ask = () => {
      if (window.parent !== window)
        window.parent.postMessage(
          { type: "prefabnavet.support-session-ready", version: 1 },
          "*",
        );
    };
    window.addEventListener("message", receive);
    ask();
    const timer = window.setInterval(ask, 60000);
    const timeout = window.setTimeout(
      () =>
        setError(
          (current) =>
            current ||
            "Om anslutningen inte blir klar: öppna Felanmälan på nytt i Navet.",
        ),
      10000,
    );
    return () => {
      window.removeEventListener("message", receive);
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, []);
  useEffect(() => {
    if (!session || view !== "list") return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    api
      .request<{
        data: Summary[];
        total: number;
      }>(`/self-service/tickets?state=${state}&page=${page}`, {
        headers: { "X-Navet-Support": session.token },
        skipAuthRefresh: true,
        signal: controller.signal,
      })
      .then((r) => {
        if (controller.signal.aborted) return;
        setList(r.data);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [session, view, state, page]);
  useEffect(() => {
    if (!reply.trim() && !files.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [reply, files]);
  const open = async (id: string) => {
    if (!session) return;
    setBusy(true);
    setError("");
    setSent(false);
    try {
      const r = await api.request<Detail>(
        `/self-service/tickets/${encodeURIComponent(id)}`,
        {
          headers: { "X-Navet-Support": session.token },
          skipAuthRefresh: true,
        },
      );
      if (identityRef.current !== session.subject) return;
      setDetail(r);
      setView("detail");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ärendet kunde inte öppnas.");
    } finally {
      setBusy(false);
    }
  };
  const replyToTicket = async () => {
    if (!session || !detail || !reply.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api.submitSupportReply(detail.id, reply, {
        supportToken: session.token,
        idempotencyKey: replyKey.current,
        attachments: files,
      });
      if (identityRef.current !== session.subject) return;
      setReply("");
      setFiles([]);
      replyKey.current = crypto.randomUUID();
      await open(detail.id);
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "IDEMPOTENCY_CONFLICT")
        replyKey.current = crypto.randomUUID();
      setError(e instanceof Error ? e.message : "Svaret kunde inte skickas.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 text-foreground">
      <h1 className="text-2xl font-display">IT-hjälp</h1>
      <p className="text-muted-foreground mt-1">
        Anmäl ett problem eller följ dina ärenden.
      </p>
      {!session ? (
        <div className="mt-6" role="status">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
          Ansluter till Navet…{error && <p className="mt-3">{error}</p>}
        </div>
      ) : (
        <>
          <nav
            aria-label="IT-hjälp"
            className="flex gap-4 border-b border-border mt-5 mb-5"
          >
            <Button
              variant="ghost"
              className={
                view === "new"
                  ? "rounded-none border-b-2 border-primary"
                  : "rounded-none"
              }
              aria-pressed={view === "new"}
              onClick={async () => {
                if (reply.trim() || files.length) {
                  if (
                    !(await confirm(
                      "Du har ett oskickat svar. Vill du lämna ärendet?",
                      "Lämna ärendet",
                    ))
                  )
                    return;
                  setReply("");
                  setFiles([]);
                }
                setView("new");
              }}
            >
              Anmäl ett problem
            </Button>
            <Button
              variant="ghost"
              className={
                view !== "new"
                  ? "rounded-none border-b-2 border-primary"
                  : "rounded-none"
              }
              aria-pressed={view !== "new"}
              onClick={async () => {
                if (reply.trim() || files.length) {
                  if (
                    !(await confirm(
                      "Du har ett oskickat svar. Vill du lämna ärendet?",
                      "Lämna ärendet",
                    ))
                  )
                    return;
                  setReply("");
                  setFiles([]);
                }
                setView("list");
              }}
            >
              Mina ärenden
            </Button>
          </nav>
          {error && (
            <p role="alert" className="text-destructive mb-4">
              {error}
            </p>
          )}
          <div hidden={view !== "new"}>
            <PublicTicketForm
              key={`${session.subject}:${created || "new"}`}
              profile={{
                ...session.profile,
                photo: visualProfile?.photo || null,
              }}
              embedded
              supportToken={session.token}
              onCreated={(id) => {
                if (identityRef.current !== session.subject) return;
                setCreated(id);
                setView("confirm");
              }}
            />
          </div>
          {view === "confirm" && (
            <section className="bg-card border border-border rounded-xl p-8 text-center">
              <CheckCircle className="mx-auto mb-4 h-8 w-8 text-primary" />
              <h2 className="text-xl">Ditt ärende har kommit fram</h2>
              <p className="my-4 text-muted-foreground">
                Du hittar svar och uppdateringar under Mina ärenden.
              </p>
              <Button onClick={() => open(created)}>Visa ärendet</Button>
            </section>
          )}
          {view === "list" && (
            <section>
              <div className="flex gap-2 mb-4">
                {["open", "closed"].map((s) => (
                  <Button
                    key={s}
                    variant={s === state ? "default" : "outline"}
                    aria-pressed={s === state}
                    onClick={() => {
                      setState(s);
                      setPage(1);
                    }}
                  >
                    {s === "open" ? "Öppna" : "Avslutade"}
                  </Button>
                ))}
              </div>
              {busy ? (
                <p role="status">Laddar ärenden…</p>
              ) : (
                <>
                  <div className="bg-card border border-border rounded-xl divide-y divide-border">
                    {list.map((t) => (
                      <button
                        key={t.id}
                        className="block w-full p-5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                        onClick={() => {
                          setReply("");
                          open(t.id);
                        }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{t.title}</span>
                          <span className="text-sm bg-muted rounded-full px-3 py-1">
                            {labels[t.status] || t.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Senast uppdaterat {date(t.updated_at)}
                        </p>
                      </button>
                    ))}
                    {list.length === 0 && !error && (
                      <p className="p-6 text-muted-foreground">
                        Du har inga {state === "open" ? "öppna" : "avslutade"}{" "}
                        ärenden här.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3 items-center mt-3">
                    {page > 1 && (
                      <Button
                        variant="outline"
                        onClick={() => setPage(page - 1)}
                      >
                        Föregående
                      </Button>
                    )}
                    {total > page * 30 && (
                      <Button
                        variant="outline"
                        onClick={() => setPage(page + 1)}
                      >
                        Nästa
                      </Button>
                    )}
                  </div>
                </>
              )}
              <p className="text-sm text-muted-foreground mt-3">
                Här visas ärenden som du skickat in via den nya IT-hjälpen i
                Navet.
              </p>
            </section>
          )}
          {view === "detail" && detail && (
            <section>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (
                    (reply.trim() || files.length) &&
                    !(await confirm(
                      "Du har ett oskickat svar. Vill du lämna ärendet?",
                      "Lämna ärendet",
                    ))
                  )
                    return;
                  setReply("");
                  setFiles([]);
                  replyKey.current = crypto.randomUUID();
                  setView("list");
                }}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Till mina ärenden
              </Button>
              <div className="bg-card border border-border rounded-xl p-5 mt-3">
                <div className="flex justify-between gap-3 flex-wrap">
                  <h2 className="text-xl font-display">{detail.title}</h2>
                  <span className="text-sm text-muted-foreground">
                    {labels[detail.status] || detail.status}
                  </span>
                </div>
                <article className="py-5 border-b border-border">
                  <p className="font-medium">Din anmälan</p>
                  <p className="mt-2 whitespace-pre-wrap break-words">
                    {detail.description}
                  </p>
                </article>
                {detail.comments.map((c) => (
                  <article key={c.id} className="py-5 border-b border-border">
                    <div className="flex gap-3 flex-wrap">
                      <span className="font-medium">{c.author}</span>
                      <span className="text-xs text-muted-foreground">
                        {date(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {c.content}
                    </p>
                  </article>
                ))}
                {detail.attachments.length > 0 && (
                  <div className="py-3">
                    <h3 className="font-medium">Dina bilagor</h3>
                    {detail.attachments.map((file) => (
                      <Button
                        key={file.id}
                        variant="link"
                        onClick={async () => {
                          try {
                            const blob = await api.requestBlob(
                              `/self-service/tickets/${detail.id}/files/${file.id}`,
                              {
                                supportToken: session.token,
                                redirectOnAuthFailure: false,
                              },
                            );
                            downloadBlob(blob, file.file_name);
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Filen kunde inte hämtas.",
                            );
                          }
                        }}
                      >
                        {file.file_name}
                      </Button>
                    ))}
                  </div>
                )}
                {detail.status !== "closed" ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      replyToTicket();
                    }}
                    className="mt-5"
                  >
                    <Label htmlFor="support-reply">Ditt svar till IT</Label>
                    <Textarea
                      id="support-reply"
                      className="mt-2"
                      value={reply}
                      maxLength={20000}
                      onChange={(e) => setReply(e.target.value)}
                      required
                    />
                    <FileUpload
                      attachments={[]}
                      pendingFiles={files}
                      onFilesSelect={(incoming) =>
                        setFiles((current) => [...current, ...incoming])
                      }
                      onRemovePending={(index) =>
                        setFiles((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      onRemoveAttachment={() => {}}
                      disabled={busy}
                      compact
                    />
                    <div className="flex justify-end mt-3">
                      <Button disabled={busy || !reply.trim()} type="submit">
                        {busy ? "Skickar…" : "Skicka svar"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-4 text-muted-foreground">
                    Ärendet är avslutat.
                  </p>
                )}
                {sent && (
                  <p role="status" className="mt-3">
                    Ditt svar är skickat.
                  </p>
                )}
              </div>
            </section>
          )}
        </>
      )}
      {confirmationDialog}
    </main>
  );
}
