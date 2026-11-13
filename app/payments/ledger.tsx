"use client";
import Reports from "./reports";
import Company from "./company";
import WorkerDashboard from "./worker";
import Projects, { WorkTarget } from "./projects";
import OpeningInput from "./opening-input";
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
const money = (p: number) =>
  new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 2 }).format(p / 100);
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
  const [workProject, setWorkProject] = useState("");
  const [area, setArea] = useState<"company" | "worker">("company");
  const [currency, setCurrency] = useState<"BDT" | "USD">("BDT");
  const selectedWorker = useRef("");
  const sequence = useRef(0);
  const [settings, setSettings] = useState(false);
  const settingsBaseline = useRef(0);
  const [newWorker, setNewWorker] = useState(false),
    [setupUrl, setSetupUrl] = useState("");
  const who = (r: Role) => data?.names[r] || "Team member";
  const [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [invite, setInvite] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"work" | "payment" | "history">("work"),
    [edit, setEdit] = useState<Entry | null>(null),
    [adding, setAdding] = useState(false),
    [query, setQuery] = useState(""),
    [pw, setPw] = useState(false),
    [draftId, setDraftId] = useState("");
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
      if (d.setupUrl) setSetupUrl(d.setupUrl);
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
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const kind = edit?.kind || (tab === "payment" ? "payment" : "work");
    if (
      await send({
        action: "save",
        id: edit?.id || draftId,
        version: edit?.version || 0,
        kind,
        projectId: f.get("projectId"),
        projectName: f.get("projectName"),
        date: f.get("date"),
        client: String(f.get("client") || ""),
        minutes: Number(f.get("hours") || 0) * 60 + Number(f.get("minutes") || 0),
        amount: Math.round(Number(f.get("amount") || 0) * 100),
        currency: kind === "payment" ? currency : undefined,
        usd: Math.round(Number(f.get("usd") || 0) * 100),
        usdRate: Math.round(Number(f.get("usdRate") || 0) * 100),
        description: String(f.get("description") || ""),
        reference: String(f.get("reference") || ""),
      })
    ) {
      setAdding(false);
      setEdit(null);
      setNotice("Saved. Balance updated for both of you.");
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
  const formKind = edit?.kind || (tab === "payment" ? "payment" : "work");
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
                setSetupUrl("");
                setNewWorker(false);
                setSettings(false);
                setAdding(false);
                setEdit(null);
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
          <>
            <div className="pay-title">
              <div>
                <p className="pay-eyebrow">WORK & PAYMENTS</p>
                <h1>{data.role === "admin" ? "Team dashboard" : data.name + "’s workspace"}</h1>
                <p>Clear accounts. Keep work moving.</p>
              </div>
              <div className="pay-user">
                <b>{data.role === "admin" ? "Administrator" : data.name}</b>
                <span>
                  {data.role === "admin" ? "Administrator" : "Team member"} · {money(data.hourlyRate)}/hour
                </span>
                <small>Syncs every 15 seconds · {new Date(data.syncedAt).toLocaleTimeString()}</small>
                <button onClick={() => void refresh()}>↻ Refresh</button>
              </div>
            </div>
            {data.role === "admin" && (
              <nav className="pay-area" aria-label="Dashboard area">
                <button aria-pressed={area === "company"} onClick={() => setArea("company")}>
                  Company overview
                </button>
                <button aria-pressed={area === "worker"} onClick={() => setArea("worker")}>
                  Worker accounts
                </button>
              </nav>
            )}
            {data.role === "admin" && area === "company" ? (
              <Company
                onOpenWorker={(id) => {
                  selectedWorker.current = id;
                  setArea("worker");
                  setAdding(false);
                  setEdit(null);
                  setQuery("");
                  setSetupUrl("");
                  setSettings(false);
                  setData(null);
                  setLoading(true);
                  void refresh();
                  window.scrollTo({ top: 0 });
                }}
              />
            ) : (
            <>
            {data.role === "admin" && (
              <section className="pay-panel">
                <div className="pay-toolbar">
                  <label>
                    Worker profile
                    <select
                      aria-label="Worker profile"
                      value={data.workerId}
                      onChange={(e) => {
                        selectedWorker.current = e.target.value;
                        setAdding(false);
                        setEdit(null);
                        setQuery("");
                        setSetupUrl("");
                        setSettings(false);
                        setData(null);
                        setLoading(true);
                        void refresh();
                      }}
                    >
                      {data.workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {w.active ? "" : " · setup pending"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="pay-primary"
                    onClick={() => {
                      setNewWorker(!newWorker);
                      setSetupUrl("");
                    }}
                  >
                    + Add worker
                  </button>
                </div>
                {newWorker && (
                  <form
                    className="pay-gridform"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (
                        await send({
                          action: "addWorker",
                          name: f.get("name"),
                          email: f.get("email"),
                          hourlyRate: Math.round(Number(f.get("hourlyRate")) * 100),
                          amount: -Math.round(Number(f.get("amount")) * 100),
                          date: f.get("date"),
                        })
                      ) {
                        setNewWorker(false);
                        setNotice("Worker added. Share the private setup link only with this worker.");
                      }
                    }}
                  >
                    <label>
                      Worker name
                      <input name="name" required maxLength={100} />
                    </label>
                    <label>
                      Worker email
                      <input name="email" type="email" required maxLength={254} />
                    </label>
                    <label>
                      Hourly rate (BDT)
                      <input
                        name="hourlyRate"
                        type="number"
                        defaultValue="250"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        required
                      />
                    </label>
                    <OpeningInput />
                    <label>
                      As of date
                      <input name="date" type="date" defaultValue={day()} required />
                    </label>
                    <p className="pay-wide">
                      Each worker has their own rate and sees only their own work and payments.
                    </p>
                    <button disabled={busy} className="pay-primary">
                      Create worker & setup link
                    </button>
                  </form>
                )}
                {setupUrl && (
                  <div role="status">
                    <p>
                      Private setup link for {data.name} · valid for 14 days. Save this link now; it is shown only once.
                    </p>
                    <input
                      aria-label="Worker setup link"
                      readOnly
                      value={setupUrl}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      onClick={() =>
                        navigator.clipboard
                          .writeText(setupUrl)
                          .then(() => setNotice("Setup link copied."))
                          .catch(() => setNotice("Select the link and copy it manually."))
                      }
                    >
                      Copy setup link
                    </button>
                  </div>
                )}
                <h2>{data.name} — profile</h2>
                <div className="pay-actions">
                  <button
                    onClick={() => {
                      settingsBaseline.current = data.settingsVersion;
                      setSettings(!settings);
                    }}
                  >
                    Rate & opening balance
                  </button>
                  {!data.active && (
                    <button disabled={busy} onClick={() => void send({ action: "inviteWorker" })}>
                      Create invitation link
                    </button>
                  )}
                </div>
                {settings && (
                  <form
                    key={data.workerId}
                    className="pay-gridform pay-entry"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (
                        await send({
                          action: "workerSettings",
                          settingsVersion: Number(f.get("settingsVersion")),
                          hourlyRate: Math.round(Number(f.get("hourlyRate")) * 100),
                          amount: -Math.round(Number(f.get("amount")) * 100),
                          date: f.get("date"),
                          note: f.get("note"),
                        })
                      ) {
                        setSettings(false);
                        setNotice("Rate and opening balance saved. Existing work keeps its original rate.");
                      }
                    }}
                  >
                    <input type="hidden" name="settingsVersion" value={settingsBaseline.current} />
                    <label>
                      Hourly rate (BDT)
                      <input
                        name="hourlyRate"
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        defaultValue={data.hourlyRate / 100}
                        required
                      />
                    </label>
                    <OpeningInput amount={data.opening?.amount || 0} />
                    <label>
                      As of date
                      <input name="date" type="date" defaultValue={data.opening?.date || day()} required />
                    </label>
                    <label className="pay-wide">
                      Opening balance note
                      <input
                        name="note"
                        maxLength={300}
                        defaultValue={data.opening?.note || ""}
                        placeholder="Previous account closing balance"
                      />
                    </label>
                    <p className="pay-muted pay-wide">
                      Enter only the previous closing due or advance. New entries stay separate. Rate changes apply to
                      new work; existing work keeps its saved rate.
                    </p>
                    <div className="pay-actions pay-wide">
                      <button className="pay-primary" disabled={busy}>
                        Save settings
                      </button>
                      <button type="button" onClick={() => setSettings(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}
            {!data.opening ? (
              <section className="pay-panel">
                <h2>Start with the correct balance</h2>
                <p>Set your opening balance once, then record new work and payments.</p>
                {data.role === "admin" ? (
                  <form
                    className="pay-gridform"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (
                        await send({
                          action: "opening",
                          amount: -Math.round(Number(f.get("amount")) * 100),
                          date: f.get("date"),
                          note: f.get("note"),
                        })
                      )
                        setNotice("Opening balance saved. Add new work and payments from now on.");
                    }}
                  >
                    <OpeningInput />
                    <label>
                      As of date
                      <input name="date" type="date" defaultValue={day()} required />
                    </label>
                    <label>
                      Source / note
                      <input name="note" maxLength={300} placeholder="Previous sheet closing balance" required />
                    </label>
                    <p className="pay-muted pay-wide">
                      Confirm the old balance before saving. Do not enter old work or payments again after carrying the
                      closing balance forward.
                    </p>
                    <button disabled={busy} className="pay-primary">
                      Set opening balance
                    </button>
                  </form>
                ) : (
                  <p>The administrator will confirm the opening balance before you add entries.</p>
                )}
              </section>
            ) : (
              <>
                <section className="pay-stats" aria-label="Account overview">
                  <article className={"pay-balance " + (data.totals.balance < 0 ? "pay-advance" : "")}>
                    <span>
                      {data.totals.balance === 0 ? "All settled" : data.totals.balance < 0 ? "Advance paid" : "Due to worker"}
                    </span>
                    <strong>{money(Math.abs(data.totals.balance))}</strong>
                    <small>
                      {data.totals.balance < 0
                        ? "Paid ahead of completed work"
                        : data.totals.balance > 0
                          ? "Amount remaining to pay"
                          : "No outstanding balance"}
                    </small>
                  </article>
                  <article>
                    <span>Hours worked</span>
                    <strong>
                      {Math.floor(data.totals.minutes / 60)}
                      <small>h {data.totals.minutes % 60}m</small>
                    </strong>
                    <small>
                      {data.entries.filter((e) => !e.voided && e.kind === "work").length} work entries ·{" "}
                      {money(data.hourlyRate)}/hour
                    </small>
                  </article>
                  <article>
                    <span>Work earned</span>
                    <strong>{money(data.totals.earned)}</strong>
                    <small>Hours × saved hourly rate</small>
                  </article>
                  <article>
                    <span>Total paid</span>
                    <strong>{money(data.totals.paid)}</strong>
                    <small>All recorded payments</small>
                  </article>
                </section>
                <p className="pay-opening">
                  Opening {data.opening.amount < 0 ? "advance" : "due"}: {money(Math.abs(data.opening.amount))} ·{" "}
                  {data.opening.date}
                </p>
                <div className="pay-quick">
                  <p>Log work hours and payments. Your due or advance updates automatically.</p>
                  <div className="pay-actions">
                    <button
                      className="pay-primary"
                      onClick={() => {
                        setTab("work");
                        setEdit(null);
                        setWorkProject("");
                        setDraftId(crypto.randomUUID());
                        setAdding(true);
                        setTimeout(
                          () => document.getElementById("entry-panel")?.scrollIntoView({ behavior: "smooth" }),
                          0,
                        );
                      }}
                    >
                      + Add work
                    </button>
                    <button
                      onClick={() => {
                        setTab("payment");
                        setEdit(null);
                        setWorkProject("");
                        setDraftId(crypto.randomUUID());
                        setAdding(true);
                        setTimeout(
                          () => document.getElementById("entry-panel")?.scrollIntoView({ behavior: "smooth" }),
                          0,
                        );
                      }}
                    >
                      + Add payment
                    </button>
                  </div>
                </div>
                <Projects
                  key={data.workerId}
                  projects={data.projects || []}
                  entries={data.entries}
                  busy={busy}
                  send={send}
                  onHours={(id) => {
                    setWorkProject(id);
                    setTab("work");
                    setEdit(null);
                    setDraftId(crypto.randomUUID());
                    setAdding(true);
                    setTimeout(() => document.getElementById("entry-panel")?.scrollIntoView({ behavior: "smooth" }), 0);
                  }}
                />
                <datalist id="payment-clients">
                  {[
                    ...new Set([
                      ...data.entries.map((e) => e.client),
                      ...(data.history?.records.filter((r) => r.kind === "work").map((r) => r.label.trim()) || []),
                    ]),
                  ]
                    .filter(Boolean)
                    .sort()
                    .map((c) => (
                      <option key={c} value={c} />
                    ))}
                </datalist>

                <section className="pay-panel" id="entry-panel">
                  <h2>Work & payments</h2>
                  <div className="pay-toolbar">
                    <nav aria-label="Ledger view">
                      {(["work", "payment", "history"] as const).map((t) => (
                        <button
                          key={t}
                          aria-pressed={tab === t}
                          onClick={() => {
                            setTab(t);
                            setAdding(false);
                            setEdit(null);
                          }}
                        >
                          {t === "work" ? "Work entries" : t === "payment" ? "Payments" : "Activity log"}
                        </button>
                      ))}
                    </nav>
                    {tab !== "history" && (
                      <button
                        className="pay-primary"
                        onClick={() => {
                          setEdit(null);
                          setWorkProject("");
                          setDraftId(crypto.randomUUID());
                          setAdding(true);
                        }}
                      >
                        + {tab === "work" ? "Add work" : "Add payment"}
                      </button>
                    )}
                  </div>
                  {(adding || edit) && (
                    <form className="pay-gridform pay-entry" key={edit?.id || draftId} onSubmit={save}>
                      <h2 className="pay-wide">
                        {edit ? "Edit" : "New"} {formKind === "work" ? "work entry" : "payment received"}
                      </h2>
                      <label>
                        Date
                        <input name="date" type="date" defaultValue={edit?.date || day()} required />
                      </label>
                      {formKind === "work" ? (
                        <>
                          <WorkTarget
                            projects={data.projects || []}
                            initialId={edit?.projectId || workProject}
                            client={edit?.client}
                            locked={!!edit?.projectId}
                          />
                          <p className="pay-muted pay-wide">
                            Enter only the hours worked on this date. They will be added to earlier entries.
                          </p>
                          <label>
                            Hours
                            <input
                              name="hours"
                              type="number"
                              min="0"
                              max="1000"
                              step="1"
                              defaultValue={edit ? Math.floor(edit.minutes / 60) : ""}
                              required
                            />
                          </label>
                          <label>
                            Minutes
                            <input
                              name="minutes"
                              type="number"
                              min="0"
                              max="59"
                              step="1"
                              defaultValue={edit ? edit.minutes % 60 : 0}
                              required
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label>
                            Paid in
                            <select
                              aria-label="Payment currency"
                              value={currency}
                              onChange={(e) => setCurrency(e.target.value as "BDT" | "USD")}
                            >
                              <option value="BDT">Taka (bKash, bank, cash)</option>
                              <option value="USD">US dollars</option>
                            </select>
                          </label>
                          {currency === "USD" ? (
                            <UsdAmount usd={edit?.usd} rate={edit?.usdRate} />
                          ) : (
                            <label>
                              Amount received (BDT)
                              <input
                                name="amount"
                                type="number"
                                min="0.01"
                                max="1000000"
                                step="0.01"
                                defaultValue={edit ? edit.amount / 100 : ""}
                                required
                              />
                            </label>
                          )}
                          <label>
                            Client (optional)
                            <input
                              name="client"
                              list="payment-clients"
                              defaultValue={edit?.client}
                              maxLength={120}
                              placeholder="Leave blank for a general payment"
                            />
                          </label>
                          <label>
                            Method / reference
                            <input
                              name="reference"
                              defaultValue={edit?.reference}
                              maxLength={100}
                              placeholder="bKash, bank, cash, transaction ID"
                            />
                          </label>
                        </>
                      )}
                      <label className="pay-wide">
                        {formKind === "work" ? "Project / work description" : "Payment note"}
                        <input name="description" defaultValue={edit?.description} maxLength={300} />
                      </label>
                      <p className="pay-muted pay-wide">
                        {formKind === "work"
                          ? `Time × ${money(edit?.hourlyRate ?? (edit ? 25000 : data.hourlyRate))}/hour. Use 30 minutes for half an hour.`
                          : "Record an existing payment here; this does not transfer money. Check the list first so the same payment is not added twice."}
                      </p>
                      <div className="pay-actions pay-wide">
                        <button className="pay-primary" disabled={busy}>
                          {busy ? "Saving…" : "Save entry"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAdding(false);
                            setEdit(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  {tab === "history" ? (
                    <div className="pay-history">
                      {data.audit.map((a, i) => (
                        <article key={i}>
                          <strong>{a.action}</strong>
                          <span>
                            {who(a.by)} · {new Date(a.at).toLocaleString()}
                          </span>
                          <details>
                            <summary>View change</summary>
                            <pre>{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                          </details>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <>
                      <input
                        className="pay-search"
                        aria-label="Search entries"
                        placeholder="Search client, notes, reference or date…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <div className="pay-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>{tab === "work" ? "Client / project" : "Payment / reference"}</th>
                              {tab === "work" && <th>Time</th>}
                              <th>Amount</th>
                              <th>Added by</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.entries
                              .filter(
                                (e) =>
                                  e.kind === tab &&
                                  `${e.client} ${e.description} ${e.reference} ${e.date}`
                                    .toLowerCase()
                                    .includes(query.toLowerCase()),
                              )
                              .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
                              .map((e) => (
                                <tr key={e.id} className={e.voided ? "pay-void" : ""}>
                                  <td>{e.date}</td>
                                  <td>
                                    <b>{e.kind === "work" ? e.client : e.reference || "Payment received"}</b>
                                    <small>
                                      {e.projectName}
                                      {e.projectName && e.description ? " · " : ""}
                                      {e.description}
                                    </small>
                                    {e.voided && <small>Voided — excluded from totals</small>}
                                  </td>
                                  {tab === "work" && (
                                    <td>
                                      {Math.floor(e.minutes / 60)}h {e.minutes % 60}m
                                      <small>{money(e.hourlyRate ?? 25000)}/hour</small>
                                    </td>
                                  )}
                                  <td>
                                    {money(e.amount)}
                                    {e.usd ? (
                                      <small>
                                        ${(e.usd / 100).toLocaleString()} × {(e.usdRate || 0) / 100}
                                      </small>
                                    ) : null}
                                  </td>
                                  <td>{who(e.by)}</td>
                                  <td>
                                    {!e.voided && (data.role === "admin" || e.by === data.role) && (
                                      <button
                                        onClick={() => {
                                          setEdit(e);
                                          setCurrency(e.usd ? "USD" : "BDT");
                                          setAdding(false);
                                        }}
                                      >
                                        Edit
                                      </button>
                                    )}
                                    {!e.voided && data.role === "admin" && (
                                      <button
                                        onClick={async () => {
                                          if (
                                            confirm("Void this entry? It stays in history but is excluded from totals.")
                                          )
                                            await send({ action: "void", id: e.id, version: e.version });
                                        }}
                                      >
                                        Void
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {!data.entries.some((e) => e.kind === tab) && (
                          <div className="pay-empty">
                            <h3>
                              {tab === "work" ? "Your next project starts here." : "Keep every payment in one place."}
                            </h3>
                            <p>
                              {tab === "work"
                                ? "Add the client and time worked. The amount is calculated automatically."
                                : "Add payments whenever they happen, independently of projects."}
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
            <Reports key={data.workerId} history={null} entries={data.entries} />
            </>
            )}
            <div className="pay-footer">
              <button onClick={download}>Download account backup</button>
              <button onClick={() => setPw(!pw)}>Change password</button>
              <span>Amounts in BDT · Dates use Bangladesh time</span>
            </div>
            {pw && (
              <form
                className="pay-panel pay-gridform"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (f.get("password") !== f.get("confirm")) {
                    setError("Passwords do not match.");
                    return;
                  }
                  if (await send({ action: "password", oldPassword: f.get("old"), password: f.get("password") })) {
                    setPw(false);
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
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={200}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input name="confirm" type="password" required autoComplete="new-password" />
                </label>
                <button className="pay-primary" disabled={busy}>
                  Update password
                </button>
              </form>
            )}
          </>
          )
        )}
      </main>
    </div>
  );
}

// Dollar payment: the worker's account is credited in taka at the given rate.
function UsdAmount({ usd, rate }: { usd?: number; rate?: number }) {
  const [dollars, setDollars] = useState(usd ? String(usd / 100) : "");
  const [bdtRate, setBdtRate] = useState(rate ? String(rate / 100) : "");
  const taka = Math.round(Number(dollars) * Number(bdtRate) * 100) / 100;
  return (
    <>
      <label>
        Amount sent (USD)
        <input
          name="usd"
          type="number"
          min="0.01"
          max="100000"
          step="0.01"
          value={dollars}
          onChange={(e) => setDollars(e.target.value)}
          required
        />
      </label>
      <label>
        Rate (BDT per USD)
        <input
          name="usdRate"
          type="number"
          min="1"
          max="1000"
          step="0.01"
          value={bdtRate}
          onChange={(e) => setBdtRate(e.target.value)}
          placeholder="e.g. 122.50"
          required
        />
      </label>
      <p className="pay-muted pay-wide">
        {taka > 0 ? `Worker receives ${taka.toLocaleString("en-BD")} BDT in their account.` : "Enter dollars and rate."}
      </p>
    </>
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
