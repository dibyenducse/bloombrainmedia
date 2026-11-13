"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { Entry, Project } from "@/lib/payments/store";

// Worker-only dashboard: their projects, hours, payments and balance.
export type WorkerData = {
  name: string;
  hourlyRate: number;
  projects: Project[];
  entries: Entry[];
  opening: { amount: number; date: string; note: string } | null;
  totals: { minutes: number; earned: number; paid: number; balance: number };
  syncedAt: string;
};

const bdt = (p: number) =>
  new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 0 }).format(p / 100);
const hm = (m: number) => (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`);
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
const nice = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short" });
const statusText = { active: "Running", paused: "Paused", completed: "Delivered" } as const;

type Sheet =
  | { kind: "hours"; projectId?: string; entry?: Entry }
  | { kind: "payment"; entry?: Entry }
  | { kind: "project" }
  | null;

export default function WorkerDashboard({
  data,
  busy,
  send,
  onDownload,
  onPassword,
}: {
  data: WorkerData;
  busy: boolean;
  send: (body: object) => Promise<boolean>;
  onDownload: () => void;
  onPassword: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<"open" | "completed" | "all">("open");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"work" | "payment">("work");
  const [toast, setToast] = useState("");
  const [more, setMore] = useState(false);
  const month = today().slice(0, 7);
  const live = data.entries.filter((e) => !e.voided);

  const stats = useMemo(() => {
    const work = live.filter((e) => e.kind === "work");
    const thisMonth = work.filter((e) => e.date.startsWith(month));
    return {
      monthMinutes: thisMonth.reduce((a, e) => a + e.minutes, 0),
      monthEarned: thisMonth.reduce((a, e) => a + e.amount, 0),
      running: data.projects.filter((p) => p.status !== "completed").length,
    };
  }, [live, month, data.projects]);

  const months = useMemo(() => {
    const out: { month: string; label: string; hours: number; earned: number; paid: number }[] = [];
    const d = new Date(month + "-01T00:00:00");
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      const rows = live.filter((e) => e.date.startsWith(key));
      out.push({
        month: key,
        label: monthName(key),
        hours: Math.round((rows.filter((e) => e.kind === "work").reduce((a, e) => a + e.minutes, 0) / 60) * 10) / 10,
        earned: rows.filter((e) => e.kind === "work").reduce((a, e) => a + e.amount, 0),
        paid: rows.filter((e) => e.kind === "payment").reduce((a, e) => a + e.amount, 0),
      });
    }
    return out;
  }, [live, month]);

  const projects = data.projects
    .filter((p) => (filter === "all" ? true : filter === "completed" ? p.status === "completed" : p.status !== "completed"))
    .filter((p) => `${p.client} ${p.name}`.toLowerCase().includes(query.toLowerCase()))
    .map((p) => {
      const logs = live.filter((e) => e.kind === "work" && e.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date));
      return {
        ...p,
        logs,
        minutes: logs.reduce((a, e) => a + e.minutes, 0),
        monthMinutes: logs.filter((e) => e.date.startsWith(month)).reduce((a, e) => a + e.minutes, 0),
        earned: logs.reduce((a, e) => a + e.amount, 0),
        last: logs[0]?.date,
        first: logs[logs.length - 1]?.date,
      };
    })
    .sort((a, b) => (b.last || b.createdAt).localeCompare(a.last || a.createdAt));

  function open(next: Sheet) {
    setDraft(crypto.randomUUID());
    setSheet(next);
    setTimeout(() => document.getElementById("wk-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  async function done(ok: boolean, message: string) {
    if (!ok) return;
    setSheet(null);
    setToast(message);
    setTimeout(() => setToast(""), 3500);
  }

  const balance = data.totals.balance;
  return (
    <div className="wk">
      <section className="wk-hero">
        <div className="wk-hello">
          <p className="pay-eyebrow">YOUR WORKSPACE</p>
          <h1>Hi, {data.name.split(" ")[0]} 👋</h1>
          <p>{nice(today())} · {bdt(data.hourlyRate)}/hour</p>
        </div>
        <div className={"wk-balance " + (balance < 0 ? "is-advance" : balance === 0 ? "is-settled" : "")}>
          <span>{balance > 0 ? "BloomBrain owes you" : balance < 0 ? "Advance received" : "All settled"}</span>
          <strong>{bdt(Math.abs(balance))}</strong>
          <small>
            Earned {bdt(data.totals.earned)} · Paid {bdt(data.totals.paid)}
            {data.opening?.amount ? ` · Opening ${data.opening.amount > 0 ? "due" : "advance"} ${bdt(Math.abs(data.opening.amount))}` : ""}
          </small>
        </div>
      </section>

      <section className="wk-stats">
        <article>
          <span>This month</span>
          <strong>{hm(stats.monthMinutes)}</strong>
          <small>{bdt(stats.monthEarned)} earned</small>
        </article>
        <article>
          <span>All-time hours</span>
          <strong>{hm(data.totals.minutes)}</strong>
          <small>{live.filter((e) => e.kind === "work").length} entries</small>
        </article>
        <article>
          <span>Active projects</span>
          <strong>{stats.running}</strong>
          <small>{data.projects.length} total</small>
        </article>
      </section>

      <div className="wk-actions">
        <button className="wk-primary" onClick={() => open({ kind: "hours" })} disabled={!data.opening}>
          ＋ Log hours
        </button>
        <button onClick={() => open({ kind: "project" })}>＋ New project</button>
        <button onClick={() => open({ kind: "payment" })} disabled={!data.opening}>
          ＋ Payment received
        </button>
      </div>
      {!data.opening && <p className="wk-note">Your account is being set up. You can add hours once the administrator confirms your opening balance.</p>}
      {toast && (
        <p className="wk-toast" role="status">
          ✓ {toast}
        </p>
      )}

      {sheet && (
        <section id="wk-sheet" className="wk-sheet">
          {sheet.kind === "project" && (
            <ProjectForm
              busy={busy}
              onCancel={() => setSheet(null)}
              onSubmit={async (client, name) =>
                done(await send({ action: "createProject", client, name }), "Project created. Log hours on it any time.")
              }
            />
          )}
          {sheet.kind === "hours" && (
            <HoursForm
              key={sheet.entry?.id || draft}
              projects={data.projects}
              rate={sheet.entry?.hourlyRate ?? data.hourlyRate}
              entry={sheet.entry}
              projectId={sheet.projectId}
              busy={busy}
              onCancel={() => setSheet(null)}
              onNewProject={() => open({ kind: "project" })}
              onSubmit={async (v) =>
                done(
                  await send({
                    action: "save",
                    id: sheet.entry?.id || draft,
                    version: sheet.entry?.version || 0,
                    kind: "work",
                    client: "",
                    amount: 0,
                    reference: "",
                    ...v,
                  }),
                  sheet.entry ? "Hours updated." : "Hours saved. Your balance is updated.",
                )
              }
            />
          )}
          {sheet.kind === "payment" && (
            <PaymentForm
              key={sheet.entry?.id || draft}
              entry={sheet.entry}
              busy={busy}
              onCancel={() => setSheet(null)}
              onSubmit={async (v) =>
                done(
                  await send({
                    action: "save",
                    id: sheet.entry?.id || draft,
                    version: sheet.entry?.version || 0,
                    kind: "payment",
                    client: "",
                    minutes: 0,
                    ...v,
                  }),
                  sheet.entry ? "Payment updated." : "Payment saved.",
                )
              }
            />
          )}
        </section>
      )}

      <section className="wk-panel">
        <div className="wk-head">
          <h2>My projects</h2>
          <div className="wk-chips" role="group" aria-label="Project filter">
            {(
              [
                ["open", "Running"],
                ["completed", "Delivered"],
                ["all", "All"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {data.projects.length > 4 && (
          <input
            className="wk-search"
            placeholder="Search client or project…"
            aria-label="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="wk-projects">
          {projects.map((p) => (
            <article key={p.id} className="wk-project">
              <div className="wk-project-top">
                <div>
                  <span className="wk-client">{p.client}</span>
                  <h3>{p.name}</h3>
                </div>
                <span className={"wk-pill is-" + p.status}>{statusText[p.status]}</span>
              </div>
              <div className="wk-project-stats">
                <div>
                  <span>Total</span>
                  <b>{hm(p.minutes)}</b>
                </div>
                <div>
                  <span>This month</span>
                  <b>{hm(p.monthMinutes)}</b>
                </div>
                <div>
                  <span>Earned</span>
                  <b>{bdt(p.earned)}</b>
                </div>
              </div>
              <p className="wk-meta">
                {p.first ? `Started ${nice(p.first)}` : "No hours yet"}
                {p.deliveredAt ? ` · Delivered ${nice(p.deliveredAt)}` : p.last ? ` · Last worked ${nice(p.last)}` : ""}
              </p>
              <div className="wk-project-actions">
                {p.status !== "completed" ? (
                  <button className="wk-primary" disabled={busy || !data.opening} onClick={() => open({ kind: "hours", projectId: p.id })}>
                    ＋ Log hours
                  </button>
                ) : (
                  <span />
                )}
                <select
                  aria-label={`Status of ${p.name}`}
                  value={p.status}
                  disabled={busy}
                  onChange={(e) => void send({ action: "projectStatus", id: p.id, version: p.version, status: e.target.value })}
                >
                  <option value="active">Running</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Delivered</option>
                </select>
              </div>
              {p.logs.length > 0 && (
                <details className="wk-logs">
                  <summary>Time history · {p.logs.length}</summary>
                  <ul>
                    {p.logs.map((e) => (
                      <li key={e.id}>
                        <span>{nice(e.date)}</span>
                        <b>{hm(e.minutes)}</b>
                        <em>{e.description}</em>
                        {e.by !== "admin" && (
                          <button className="wk-link" onClick={() => open({ kind: "hours", entry: e })}>
                            Edit
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
          {!projects.length && (
            <div className="wk-empty">
              <h3>{data.projects.length ? "Nothing here" : "No projects yet"}</h3>
              <p>
                {data.projects.length
                  ? "Try another filter."
                  : "When a project is assigned to you it appears here. You can also create one yourself."}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="wk-grid">
        <div className="wk-panel">
          <div className="wk-head">
            <h2>Recent activity</h2>
            <div className="wk-chips" role="group" aria-label="Activity type">
              <button aria-pressed={tab === "work"} onClick={() => setTab("work")}>
                Hours
              </button>
              <button aria-pressed={tab === "payment"} onClick={() => setTab("payment")}>
                Payments
              </button>
            </div>
          </div>
          <ul className="wk-feed">
            {data.entries
              .filter((e) => e.kind === tab)
              .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
              .slice(0, more ? 200 : 8)
              .map((e) => (
                <li key={e.id} className={e.voided ? "is-void" : ""}>
                  <div>
                    <b>{e.kind === "work" ? `${e.client} · ${e.projectName || "Work"}` : e.reference || "Payment received"}</b>
                    <small>
                      {nice(e.date)}
                      {e.description ? ` · ${e.description}` : ""}
                      {e.voided ? " · voided" : ""}
                      {e.by === "admin" ? " · added by admin" : ""}
                    </small>
                  </div>
                  <div className="wk-feed-amount">
                    {e.kind === "work" ? <b>{hm(e.minutes)}</b> : <b>{bdt(e.amount)}</b>}
                    <small>
                      {e.kind === "work" ? bdt(e.amount) : e.usd ? `$${e.usd / 100} × ${(e.usdRate || 0) / 100}` : ""}
                    </small>
                  </div>
                  {!e.voided && e.by !== "admin" && (
                    <button
                      className="wk-link"
                      onClick={() => open(e.kind === "work" ? { kind: "hours", entry: e } : { kind: "payment", entry: e })}
                    >
                      Edit
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {!more && data.entries.filter((e) => e.kind === tab).length > 8 && (
            <button className="wk-more" onClick={() => setMore(true)}>
              Show all {data.entries.filter((e) => e.kind === tab).length}
            </button>
          )}
          {!data.entries.some((e) => e.kind === tab) && (
            <p className="wk-muted">{tab === "work" ? "No hours logged yet." : "No payments recorded yet."}</p>
          )}
        </div>

        <div className="wk-panel">
          <h2>Last 6 months</h2>
          <div className="wk-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months}>
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [`${v} h`, "Hours"]} cursor={{ fill: "#f1effa" }} />
                <Bar dataKey="hours" fill="#6040b9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="wk-months">
            <thead>
              <tr>
                <th>Month</th>
                <th>Hours</th>
                <th>Earned</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month}>
                  <td>{m.label}</td>
                  <td>{m.hours}h</td>
                  <td>{bdt(m.earned)}</td>
                  <td>{bdt(m.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="wk-footer">
        <button onClick={onPassword}>Change password</button>
        <button onClick={onDownload}>Download my records</button>
        <span>Amounts in BDT · Bangladesh time · Synced {new Date(data.syncedAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

function ProjectForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (client: string, name: string) => void;
}) {
  return (
    <form
      className="wk-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit(String(f.get("client")), String(f.get("name")));
      }}
    >
      <h2>New project</h2>
      <label>
        Client
        <input name="client" maxLength={120} required placeholder="e.g. Mark" autoFocus />
      </label>
      <label>
        Project name
        <input name="name" maxLength={120} required placeholder="e.g. Real estate reel" />
      </label>
      <div className="wk-form-actions">
        <button className="wk-primary" disabled={busy}>
          Create project
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function HoursForm({
  projects,
  rate,
  entry,
  projectId,
  busy,
  onCancel,
  onNewProject,
  onSubmit,
}: {
  projects: Project[];
  rate: number;
  entry?: Entry;
  projectId?: string;
  busy: boolean;
  onCancel: () => void;
  onNewProject: () => void;
  onSubmit: (v: { projectId: string; date: string; minutes: number; description: string }) => void;
}) {
  const choices = projects.filter((p) => p.status !== "completed" || p.id === entry?.projectId);
  const [hours, setHours] = useState(entry ? String(Math.floor(entry.minutes / 60)) : "");
  const [mins, setMins] = useState(entry ? String(entry.minutes % 60) : "0");
  const minutes = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  if (!choices.length)
    return (
      <div className="wk-form">
        <h2>Log hours</h2>
        <p className="wk-muted">You need a running project first.</p>
        <div className="wk-form-actions">
          <button className="wk-primary" onClick={onNewProject}>
            ＋ Create a project
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <form
      className="wk-form"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          projectId: String(f.get("projectId")),
          date: String(f.get("date")),
          minutes,
          description: String(f.get("description") || ""),
        });
      }}
    >
      <h2>{entry ? "Edit hours" : "Log hours"}</h2>
      <label className="wk-wide">
        Project
        <select name="projectId" defaultValue={entry?.projectId || projectId || choices[0].id} disabled={!!entry} required>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.client} — {p.name}
            </option>
          ))}
        </select>
        {entry && <input type="hidden" name="projectId" value={entry.projectId} />}
      </label>
      <label>
        Date
        <input name="date" type="date" max={today()} defaultValue={entry?.date || today()} required />
      </label>
      <div className="wk-time">
        <label>
          Hours
          <input type="number" min="0" max="24" step="1" value={hours} onChange={(e) => setHours(e.target.value)} required autoFocus />
        </label>
        <label>
          Minutes
          <select value={mins} onChange={(e) => setMins(e.target.value)}>
            {[0, 15, 30, 45].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {![0, 15, 30, 45].includes(Number(mins)) && <option value={mins}>{mins}</option>}
          </select>
        </label>
      </div>
      <label className="wk-wide">
        What did you work on? (optional)
        <input name="description" maxLength={300} defaultValue={entry?.description} placeholder="e.g. First cut, revisions, color" />
      </label>
      <p className="wk-calc wk-wide">
        {minutes > 0 ? (
          <>
            {hm(minutes)} × {bdt(rate)}/h = <b>{bdt(Math.round((minutes * rate) / 60))}</b> added to your account
          </>
        ) : (
          "Enter the time you worked on this date."
        )}
      </p>
      <div className="wk-form-actions wk-wide">
        <button className="wk-primary" disabled={busy || minutes <= 0}>
          {busy ? "Saving…" : entry ? "Save changes" : "Save hours"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PaymentForm({
  entry,
  busy,
  onCancel,
  onSubmit,
}: {
  entry?: Entry;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: object) => void;
}) {
  const [currency, setCurrency] = useState<"BDT" | "USD">(entry?.usd ? "USD" : "BDT");
  const [usd, setUsd] = useState(entry?.usd ? String(entry.usd / 100) : "");
  const [rate, setRate] = useState(entry?.usdRate ? String(entry.usdRate / 100) : "");
  const taka = Math.round(Number(usd) * Number(rate) * 100);
  return (
    <form
      className="wk-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          date: f.get("date"),
          currency,
          amount: Math.round(Number(f.get("amount") || 0) * 100),
          usd: Math.round(Number(usd || 0) * 100),
          usdRate: Math.round(Number(rate || 0) * 100),
          reference: String(f.get("reference") || ""),
          description: String(f.get("description") || ""),
        });
      }}
    >
      <h2>{entry ? "Edit payment" : "Payment received"}</h2>
      <label>
        Date
        <input name="date" type="date" max={today()} defaultValue={entry?.date || today()} required />
      </label>
      <label>
        Received in
        <select value={currency} onChange={(e) => setCurrency(e.target.value as "BDT" | "USD")}>
          <option value="BDT">Taka</option>
          <option value="USD">US dollars</option>
        </select>
      </label>
      {currency === "BDT" ? (
        <label>
          Amount (BDT)
          <input name="amount" type="number" min="1" step="0.01" defaultValue={entry && !entry.usd ? entry.amount / 100 : ""} required autoFocus />
        </label>
      ) : (
        <>
          <label>
            Amount (USD)
            <input type="number" min="0.01" step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} required autoFocus />
          </label>
          <label>
            Rate (BDT per USD)
            <input type="number" min="1" max="1000" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required placeholder="e.g. 122.50" />
          </label>
        </>
      )}
      <label>
        Method
        <input name="reference" list="wk-methods" maxLength={100} defaultValue={entry?.reference} placeholder="bKash, bank, cash…" />
        <datalist id="wk-methods">
          {["bKash", "Nagad", "Bank transfer", "Cash", "Payoneer"].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="wk-wide">
        Note (optional)
        <input name="description" maxLength={300} defaultValue={entry?.description} />
      </label>
      {currency === "USD" && (
        <p className="wk-calc wk-wide">{taka > 0 ? <>You received <b>{bdt(taka)}</b></> : "Enter dollars and rate."}</p>
      )}
      <div className="wk-form-actions wk-wide">
        <button className="wk-primary" disabled={busy}>
          {busy ? "Saving…" : entry ? "Save changes" : "Save payment"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
