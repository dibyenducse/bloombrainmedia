"use client";
import Company from "./company";
import WorkerDashboard from "./worker";
import type { SheetHistory } from "@/lib/payments/history";
import { useEffect, useState, useRef, type FormEvent } from "react";
import type { Project, Entry, Role, Ledger as Database } from "@/lib/payments/store";
type Data = {
  projects: Project[];
  hourlyRate: number;
  settingsVersion: number;
  active: boolean;
  history: SheetHistory | null;
  role: Role;
  workerId: string;
  name: string;
  workers: { id: string; name: string; active: boolean }[];
  names: Record<string, string>;
  opening: Database["opening"];
  entries: Entry[];
  audit: Database["audit"];
  totals: { minutes: number; earned: number; paid: number; unknownHours?: number; balance: number };
  syncedAt: string;
};
const day = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// mode: "admin" (/admin), "worker" (/worker) or "auto" (/payments, old links).
// Sign-in is shared; after sign-in each role is sent to its own page.
export default function Ledger({ mode = "auto" }: { mode?: "admin" | "worker" | "auto" }) {
  const [area, setArea] = useState<"company" | "worker">("company");
  const selectedWorker = useRef("");
  const sequence = useRef(0);
  const [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [invite, setInvite] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pw, setPw] = useState(false);
  async function refresh() {
    const seq = ++sequence.current;
    try {
      const r = await fetch(
        "/payments/api" + (selectedWorker.current ? "?worker=" + encodeURIComponent(selectedWorker.current) : ""),
        { cache: "no-store" },
      );
      const d = await r.json();
      if (seq !== sequence.current) return;
      if (r.ok) {
        setData(d);
        setError("");
      } else if (r.status === 401) {
        setData(null);
        setError("");
      } else setError(d.error);
    } catch {
      setError("Connection lost. Your last saved data is shown. Retry when online.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (token) {
      setInvite(token);
      history.replaceState(null, "", location.pathname);
    }
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", focus);
    };
  }, []);
  async function send(body: object) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/payments/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker: selectedWorker.current, ...body }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 401 && !("email" in body)) setData(null);
        throw new Error(d.error || "Could not save.");
      }
      if (d.role) {
        sequence.current++;
        setData(d);
        selectedWorker.current = d.workerId;
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (invite && f.get("password") !== f.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    if (
      await send({ action: invite ? "setup" : "login", email: f.get("email"), password: f.get("password"), invite })
    ) {
      setInvite("");
      setNotice("Signed in.");
    }
  }
  function download() {
    if (!data) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            history: data.history,
            opening: data.opening,
            projects: data.projects,
            entries: data.entries,
            audit: data.audit,
            totals: data.totals,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = "bloombrain-payment-backup-" + day() + ".json";
    a.click();
    URL.revokeObjectURL(u);
  }
  const home = data ? (data.role === "admin" ? "/admin" : "/worker") : "";
  const wrongPage = !!data && (mode === "auto" || (mode === "admin") !== (data.role === "admin"));
  useEffect(() => {
    if (wrongPage) location.replace(home + location.hash);
  }, [wrongPage, home]);
  return (
    <div className="pay-app">
      <header className="pay-head">
        <a href="/" aria-label="BloomBrain home">
          <img src="/brand/bloombrain-horizontal.png" alt="BloomBrain Media" />
        </a>
        <span>PRIVATE WORKSPACE</span>
        {data && (
          <button
            onClick={async () => {
              if (await send({ action: "logout" })) {
                setData(null);
                selectedWorker.current = "";
                setArea("company");
                setPw(false);
              }
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <main className="pay-main">
        {error && (
          <div className="pay-alert" role="alert">
            {error} <button onClick={() => void refresh()}>Refresh</button>
          </div>
        )}
        {notice && (
          <div className="pay-notice" role="status">
            {notice}
          </div>
        )}
        {loading || wrongPage ? (
          <p>Loading your workspace…</p>
        ) : !data ? (
          <section className="pay-login">
            <p className="pay-eyebrow">BLOOMBRAIN MEDIA</p>
            <h1>
              Good work.
              <br />
              <em>Clear accounts.</em>
            </h1>
            <p>Work, hours, payments and balances in one place.</p>
            <form onSubmit={auth}>
              <h2>{invite ? "Set up your account" : "Welcome back"}</h2>
              <label>
                Email
                <input name="email" type="email" autoComplete="username" required />
              </label>
              <label>
                {invite ? "Choose password" : "Password"}
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={200}
                  autoComplete={invite ? "new-password" : "current-password"}
                  required
                />
              </label>
              {invite && (
                <label>
                  Confirm password
                  <input name="confirm" type="password" autoComplete="new-password" required />
                </label>
              )}
              <button className="pay-primary" disabled={busy}>
                {busy ? "Please wait…" : invite ? "Activate account" : "Sign in"}
              </button>
              <p className="pay-muted">
                {invite
                  ? "Use at least 12 characters. Your setup link works once."
                  : "First time? Open your private account setup link. Forgotten password? Contact the workspace owner."}
              </p>
              {invite && (
                <button type="button" onClick={() => setInvite("")}>
                  Already set up? Sign in
                </button>
              )}
            </form>
          </section>
        ) : (
          data.role !== "admin" ? (
            <>
              <WorkerDashboard data={data} busy={busy} send={send} onDownload={download} onPassword={() => setPw(!pw)} />
              {pw && <PasswordForm busy={busy} send={send} setError={setError} setNotice={setNotice} close={() => setPw(false)} />}
            </>
          ) : (
          area === "worker" ? (
            <>
              <div className="wk-viewas">
                <span>
                  Viewing <b>{data.name}</b>’s workspace as they see it. Changes you make here are saved to their account.
                </span>
                <button
                  onClick={() => {
                    setArea("company");
                    window.scrollTo({ top: 0 });
                  }}
                >
                  ← Back to admin
                </button>
              </div>
              <WorkerDashboard
                key={data.workerId}
                data={data}
                busy={busy}
                send={send}
                admin
                onDownload={download}
              />
            </>
          ) : (
            <>
              <div className="pay-title">
                <div>
                  <p className="pay-eyebrow">WORK & PAYMENTS</p>
                  <h1>Team dashboard</h1>
                  <p>Clear accounts. Keep work moving.</p>
                </div>
              </div>
              <Company
                onViewWorker={(id) => {
                  selectedWorker.current = id;
                  setData(null);
                  setLoading(true);
                  setArea("worker");
                  void refresh();
                  window.scrollTo({ top: 0 });
                }}
              />
              <div className="pay-footer">
                <button onClick={() => setPw(!pw)}>Change password</button>
                <span>Amounts in BDT · Dates use Bangladesh time</span>
              </div>
              {pw && <PasswordForm busy={busy} send={send} setError={setError} setNotice={setNotice} close={() => setPw(false)} />}
            </>
          )
          )
        )}
      </main>
    </div>
  );
}

function PasswordForm({
  busy,
  send,
  setError,
  setNotice,
  close,
}: {
  busy: boolean;
  send: (body: object) => Promise<boolean>;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
  close: () => void;
}) {
  return (
    <form
      className="pay-panel pay-gridform wk-password"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) {
          setError("Passwords do not match.");
          return;
        }
        if (await send({ action: "password", oldPassword: f.get("old"), password: f.get("password") })) {
          close();
          setNotice("Password updated. Other sessions signed out.");
        }
      }}
    >
      <label>
        Current password
        <input name="old" type="password" required autoComplete="current-password" />
      </label>
      <label>
        New password
        <input name="password" type="password" minLength={12} maxLength={200} required autoComplete="new-password" />
      </label>
      <label>
        Confirm new password
        <input name="confirm" type="password" required autoComplete="new-password" />
      </label>
      <button className="pay-primary" disabled={busy}>
        Update password
      </button>
    </form>
  );
}
