"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompanyView } from "@/lib/payments/company";
import OpeningInput from "./opening-input";

const bdt = (p: number) =>
  new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 0 }).format(p / 100);
const usd = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(c / 100);
const time = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
const day = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
const monthLabel = (m: string) =>
  new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const statusLabel = { active: "Running", paused: "Paused", completed: "Delivered" } as const;
const CATEGORIES = ["AI tools", "Upwork Connects", "Software & subscriptions", "Upwork fees", "Hardware", "Other"];
const COLORS = ["#6040b9", "#1f9d8b", "#e0803a", "#3b82c4", "#c24d7a", "#7a8a2e", "#8a5a2e"];

type Project = CompanyView["projects"][number];
// Client income has no date of its own: count it in the delivery month, else the last work month.
const incomeMonth = (p: Project) => (p.deliveredAt || p.lastDate || p.createdAt).slice(0, 7);

export default function Company({ onViewWorker }: { onViewWorker: (id: string) => void }) {
  const [data, setData] = useState<CompanyView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(day().slice(0, 7));
  const [allTime, setAllTime] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [projectWorker, setProjectWorker] = useState("all");
  const [projectStatus, setProjectStatus] = useState("all");
  const [projectQuery, setProjectQuery] = useState("");
  const [addingExpense, setAddingExpense] = useState(false);
  const [expenseId, setExpenseId] = useState("");
  const [rateEdit, setRateEdit] = useState(false);
  const [addingWorker, setAddingWorker] = useState(false);
  const [workerEdit, setWorkerEdit] = useState("");
  const [setup, setSetup] = useState<{ name: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/payments/api?view=company", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load the company view.");
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // Initial fetch + 15 s sync, same pattern as the worker ledger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  async function send(body: object, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/payments/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save.");
      if (d.setupUrl) setSetup({ name: d.name, url: d.setupUrl });
      if (d.company) setData(d);
      else await load();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const inPeriod = useCallback((date: string | null | undefined) => !!date && (allTime || date.startsWith(period)), [
    allTime,
    period,
  ]);

  const summary = useMemo(() => {
    if (!data) return null;
    const work = data.entries.filter((e) => e.kind === "work" && inPeriod(e.date));
    const payments = data.entries.filter((e) => e.kind === "payment" && inPeriod(e.date));
    const expenses = data.expenses.filter((x) => !x.voided && inPeriod(x.date));
    const income = data.projects.filter((p) => p.clientPaidUsd && inPeriod(incomeMonth(p) + "-01"));
    const bills = work.reduce((a, e) => a + e.amount, 0);
    const billsUsd = Math.round((bills * 100) / data.usdRate);
    const spend = expenses.reduce((a, x) => a + x.usd, 0);
    const earned = income.reduce((a, p) => a + (p.clientPaidUsd || 0), 0);
    const byCategory = new Map<string, number>();
    for (const x of expenses) byCategory.set(x.category, (byCategory.get(x.category) || 0) + x.usd);
    return {
      minutes: work.reduce((a, e) => a + e.minutes, 0),
      workCount: work.length,
      bills,
      billsUsd,
      paid: payments.reduce((a, e) => a + e.amount, 0),
      paidUsd: payments.reduce((a, e) => a + (e.usd || 0), 0),
      spend,
      earned,
      net: earned - billsUsd - spend,
      expenses,
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [data, inPeriod]);

  const chart = useMemo(() => {
    if (!data) return [];
    const months: string[] = [];
    const d = new Date(day().slice(0, 7) + "-01T00:00:00");
    for (let i = 11; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
    }
    return months.map((m) => {
      const row: Record<string, number | string> = { month: monthLabel(m) };
      for (const w of data.workers)
        row[w.name] =
          Math.round(
            (data.entries
              .filter((e) => e.kind === "work" && e.workerId === w.id && e.date.startsWith(m))
              .reduce((a, e) => a + e.minutes, 0) /
              60) *
              10,
          ) / 10;
      const bills = data.entries.filter((e) => e.kind === "work" && e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0);
      row["Worker bills"] = Math.round(bills / data.usdRate);
      row["Expenses"] = Math.round(
        data.expenses.filter((x) => !x.voided && x.date.startsWith(m)).reduce((a, x) => a + x.usd, 0) / 100,
      );
      row["Client income"] = Math.round(
        data.projects.filter((p) => incomeMonth(p) === m).reduce((a, p) => a + (p.clientPaidUsd || 0), 0) / 100,
      );
      return row;
    });
  }, [data]);

  if (!data || !summary)
    return (
      <section className="pay-panel">
        {error ? (
          <p role="alert">
            {error} <button onClick={() => void load()}>Retry</button>
          </p>
        ) : (
          <p>Loading company overview…</p>
        )}
      </section>
    );

  const projects = data.projects
    .filter((p) => projectWorker === "all" || p.workerId === projectWorker)
    .filter((p) => projectStatus === "all" || p.status === projectStatus)
    .filter((p) => `${p.client} ${p.name} ${p.workerName}`.toLowerCase().includes(projectQuery.toLowerCase()))
    .filter(
      (p) =>
        allTime ||
        p.createdAt.startsWith(period) ||
        data.entries.some((e) => e.projectId === p.id && e.date.startsWith(period)) ||
        p.status !== "completed",
    )
    .sort((a, b) => (b.lastDate || b.createdAt).localeCompare(a.lastDate || a.createdAt));

  const clients = new Map<string, { projects: number; minutes: number; cost: number; income: number; workers: Set<string> }>();
  for (const e of data.entries.filter((e) => e.kind === "work" && inPeriod(e.date))) {
    const c = clients.get(e.client) || { projects: 0, minutes: 0, cost: 0, income: 0, workers: new Set<string>() };
    c.minutes += e.minutes;
    c.cost += e.amount;
    c.workers.add(data.workers.find((w) => w.id === e.workerId)?.name || "");
    clients.set(e.client, c);
  }
  for (const p of data.projects) {
    const used = data.entries.some((e) => e.projectId === p.id && inPeriod(e.date));
    const paidHere = !!p.clientPaidUsd && inPeriod(incomeMonth(p) + "-01");
    if (!used && !paidHere) continue;
    const c = clients.get(p.client) || { projects: 0, minutes: 0, cost: 0, income: 0, workers: new Set<string>() };
    if (used) c.projects++;
    if (paidHere) c.income += p.clientPaidUsd || 0;
    clients.set(p.client, c);
  }
  const clientRows = [...clients.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
  const periodName = allTime ? "All time" : monthLabel(period);

  return (
    <>
      {error && (
        <div className="pay-alert" role="alert">
          {error} <button onClick={() => void load()}>Refresh</button>
        </div>
      )}
      {notice && (
        <div className="pay-notice" role="status">
          {notice}
        </div>
      )}

      <section className="pay-panel">
        <div className="pay-toolbar">
          <div>
            <p className="pay-eyebrow">BLOOMBRAIN COMPANY</p>
            <h2>Company overview · {periodName}</h2>
          </div>
          <div className="pay-actions">
            <label>
              Month
              <input
                type="month"
                value={period}
                disabled={allTime}
                onChange={(e) => e.target.value && setPeriod(e.target.value)}
              />
            </label>
            <button aria-pressed={allTime} onClick={() => setAllTime(!allTime)}>
              {allTime ? "Showing all time" : "All time"}
            </button>
          </div>
        </div>
        <div className="pay-co-stats">
          <article>
            <span>Hours worked</span>
            <strong>{time(summary.minutes)}</strong>
            <small>{summary.workCount} work entries</small>
          </article>
          <article>
            <span>Worker bills</span>
            <strong>{bdt(summary.bills)}</strong>
            <small>≈ {usd(summary.billsUsd)} at {data.usdRate / 100} BDT/USD</small>
          </article>
          <article>
            <span>Paid to workers</span>
            <strong>{bdt(summary.paid)}</strong>
            <small>{summary.paidUsd ? `incl. ${usd(summary.paidUsd)} sent in USD` : "All recorded payments"}</small>
          </article>
          <article>
            <span>Company spend</span>
            <strong>{usd(summary.spend)}</strong>
            <small>{summary.expenses.length} expense entries</small>
          </article>
          <article>
            <span>Client income</span>
            <strong>{usd(summary.earned)}</strong>
            <small>Optional, entered per project</small>
          </article>
          <article className={summary.net < 0 ? "pay-co-loss" : "pay-co-profit"}>
            <span>Net (USD)</span>
            <strong>{usd(summary.net)}</strong>
            <small>Income − worker bills − spend</small>
          </article>
        </div>
        <p className="pay-muted">
          Total cost this period: <b>{usd(summary.billsUsd + summary.spend)}</b> (worker bills ≈ {usd(summary.billsUsd)} +
          spend {usd(summary.spend)}) · USD rate {data.usdRate / 100} BDT{" "}
          <button className="pay-link" onClick={() => setRateEdit(!rateEdit)}>
            change
          </button>
        </p>
        {rateEdit && (
          <form
            className="pay-gridform pay-entry"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await send(
                  { action: "companySettings", usdRate: Math.round(Number(f.get("rate")) * 100) },
                  "USD rate saved.",
                )
              )
                setRateEdit(false);
            }}
          >
            <label>
              BDT per 1 USD
              <input name="rate" type="number" min="1" max="1000" step="0.01" defaultValue={data.usdRate / 100} required />
            </label>
            <p className="pay-muted pay-wide">
              Used only to compare taka worker bills with dollar spend and income. Payments sent in USD keep their own rate.
            </p>
            <div className="pay-actions pay-wide">
              <button className="pay-primary" disabled={busy}>
                Save rate
              </button>
              <button type="button" onClick={() => setRateEdit(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="pay-co-charts">
        <article className="pay-panel">
          <h2>Hours by worker · last 12 months</h2>
          <div className="pay-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} width={40} />
                <Tooltip formatter={(v) => `${v} h`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.workers.map((w, i) => (
                  <Bar key={w.id} dataKey={w.name} stackId="h" fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="pay-panel">
          <h2>Cost & income (USD) · last 12 months</h2>
          <div className="pay-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} width={48} />
                <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Worker bills" stackId="c" fill="#6040b9" />
                <Bar dataKey="Expenses" stackId="c" fill="#e0803a" />
                <Line dataKey="Client income" stroke="#1f9d8b" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="pay-panel">
        <div className="pay-toolbar">
          <h2>Workers</h2>
          <button
            className="pay-primary"
            onClick={() => {
              setAddingWorker(!addingWorker);
              setSetup(null);
            }}
          >
            + Add worker
          </button>
        </div>
        {addingWorker && (
          <form
            className="pay-gridform pay-entry"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await send(
                  {
                    action: "addWorker",
                    name: f.get("name"),
                    email: f.get("email"),
                    hourlyRate: Math.round(Number(f.get("hourlyRate")) * 100),
                    amount: -Math.round(Number(f.get("amount")) * 100),
                    date: f.get("date"),
                  },
                  "Worker added. Send them the private setup link below.",
                )
              )
                setAddingWorker(false);
            }}
          >
            <h2 className="pay-wide">New worker</h2>
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
              <input name="hourlyRate" type="number" defaultValue="250" min="0.01" max="1000000" step="0.01" required />
            </label>
            <OpeningInput />
            <label>
              As of date
              <input name="date" type="date" defaultValue={day()} required />
            </label>
            <p className="pay-muted pay-wide">
              The worker signs in at bloombrainmedia.com/worker and sees only their own projects, hours and payments.
            </p>
            <div className="pay-actions pay-wide">
              <button className="pay-primary" disabled={busy}>
                Create worker & setup link
              </button>
              <button type="button" onClick={() => setAddingWorker(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {setup && (
          <div className="pay-setup" role="status">
            <p>
              Private setup link for <b>{setup.name}</b> · valid for 14 days and shown only once. Send it only to this
              worker.
            </p>
            <div className="pay-inline">
              <input aria-label="Setup link" readOnly value={setup.url} onFocus={(e) => e.target.select()} />
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(setup.url)
                    .then(() => setNotice("Setup link copied."))
                    .catch(() => setNotice("Select the link and copy it manually."))
                }
              >
                Copy
              </button>
              <button onClick={() => setSetup(null)}>✕</button>
            </div>
          </div>
        )}
        <div className="pay-table">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>Rate</th>
                <th>Hours this month</th>
                <th>Account</th>
                <th>Last payment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id}>
                  <td>
                    <b>{w.name}</b>
                    {!w.active && <small>Setup pending</small>}
                  </td>
                  <td>{bdt(w.hourlyRate)}/h</td>
                  <td>{time(w.monthMinutes)}</td>
                  <td>
                    <b className={w.balance > 0 ? "pay-due" : ""}>
                      {w.balance > 0 ? `To pay ${bdt(w.balance)}` : w.balance < 0 ? `Advance ${bdt(-w.balance)}` : "Settled"}
                    </b>
                    <small>
                      Earned {bdt(w.earned)} · Paid {bdt(w.paid)}
                    </small>
                  </td>
                  <td>{w.lastPayment ? `${bdt(w.lastPayment.amount)} · ${w.lastPayment.date}` : "None yet"}</td>
                  <td>
                    <div className="pay-row-actions">
                      <button className="pay-primary" onClick={() => onViewWorker(w.id)}>
                        View as worker
                      </button>
                      <button onClick={() => setWorkerEdit(workerEdit === w.id ? "" : w.id)}>Rate & balance</button>
                      {!w.active && (
                        <button disabled={busy} onClick={() => void send({ action: "inviteWorker", worker: w.id }, "New setup link created.")}>
                          Setup link
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(() => {
          const w = data.workers.find((x) => x.id === workerEdit);
          if (!w) return null;
          return (
            <form
              key={w.id + w.settingsVersion}
              className="pay-gridform pay-entry"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (
                  await send(
                    {
                      action: "workerSettings",
                      worker: w.id,
                      settingsVersion: w.settingsVersion,
                      hourlyRate: Math.round(Number(f.get("hourlyRate")) * 100),
                      amount: -Math.round(Number(f.get("amount")) * 100),
                      date: f.get("date"),
                      note: f.get("note"),
                    },
                    `${w.name}: rate and opening balance saved. Existing hours keep their original rate.`,
                  )
                )
                  setWorkerEdit("");
              }}
            >
              <h2 className="pay-wide">{w.name} · rate & opening balance</h2>
              <label>
                Hourly rate (BDT)
                <input name="hourlyRate" type="number" min="0.01" max="1000000" step="0.01" defaultValue={w.hourlyRate / 100} required />
              </label>
              <OpeningInput amount={w.opening?.amount || 0} />
              <label>
                As of date
                <input name="date" type="date" defaultValue={w.opening?.date || day()} required />
              </label>
              <label>
                Note
                <input name="note" maxLength={300} defaultValue={w.opening?.note || ""} placeholder="Previous account closing balance" />
              </label>
              <p className="pay-muted pay-wide">
                A new rate applies to hours logged from now on. The opening balance is the due or advance carried over
                before this system; don’t re-enter old work or payments.
              </p>
              <div className="pay-actions pay-wide">
                <button className="pay-primary" disabled={busy}>
                  Save
                </button>
                <button type="button" onClick={() => setWorkerEdit("")}>
                  Cancel
                </button>
              </div>
            </form>
          );
        })()}
      </section>

      <section className="pay-panel">
        <div className="pay-toolbar">
          <div>
            <p className="pay-eyebrow">ALL WORKERS</p>
            <h2>Projects</h2>
          </div>
          <button className="pay-primary" onClick={() => setNewProject(!newProject)}>
            + New project
          </button>
        </div>
        {newProject && (
          <form
            className="pay-gridform pay-entry"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await send(
                  { action: "createProject", worker: f.get("worker"), client: f.get("client"), name: f.get("name") },
                  "Project created and assigned.",
                )
              )
                setNewProject(false);
            }}
          >
            <label>
              Client name
              <input name="client" list="company-clients" maxLength={120} required />
            </label>
            <label>
              Project name
              <input name="name" maxLength={120} required placeholder="e.g. Listing video #3" />
            </label>
            <label>
              Assign to
              <select name="worker" required defaultValue="">
                <option value="" disabled>
                  Choose worker
                </option>
                {data.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <datalist id="company-clients">
              {[...new Set(data.projects.map((p) => p.client))].sort().map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="pay-muted pay-wide">The worker sees this project in their account and adds hours to it.</p>
            <div className="pay-actions pay-wide">
              <button className="pay-primary" disabled={busy}>
                Create project
              </button>
              <button type="button" onClick={() => setNewProject(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="pay-toolbar pay-filters">
          <select aria-label="Filter by worker" value={projectWorker} onChange={(e) => setProjectWorker(e.target.value)}>
            <option value="all">All workers</option>
            {data.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <select aria-label="Filter by status" value={projectStatus} onChange={(e) => setProjectStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Running</option>
            <option value="paused">Paused</option>
            <option value="completed">Delivered</option>
          </select>
          <input
            className="pay-search"
            aria-label="Search projects"
            placeholder="Search client, project or worker…"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
          />
        </div>
        <p className="pay-muted">
          {allTime ? "All projects." : `Running and paused projects, plus projects with work in ${periodName}.`} Hours and
          cost are all-time totals per project.
        </p>
        <div className="pay-table">
          <table>
            <thead>
              <tr>
                <th>Client / project</th>
                <th>Worker</th>
                <th>Status</th>
                <th>Timeline</th>
                <th>Hours</th>
                <th>Worker cost</th>
                <th>Client paid</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.client}</b>
                    <small>{p.name}</small>
                  </td>
                  <td>{p.workerName}</td>
                  <td>
                    <select
                      aria-label={`Status of ${p.name}`}
                      value={p.status}
                      disabled={busy}
                      onChange={(e) =>
                        void send({ action: "projectStatus", worker: p.workerId, id: p.id, version: p.version, status: e.target.value })
                      }
                    >
                      {(["active", "paused", "completed"] as const).map((s) => (
                        <option key={s} value={s}>
                          {statusLabel[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {p.firstDate || p.createdAt.slice(0, 10)} → {p.deliveredAt || (p.status === "completed" ? p.lastDate : "ongoing")}
                    <small>
                      {p.deliveredAt && p.firstDate
                        ? `${daysBetween(p.firstDate, p.deliveredAt)} days`
                        : `${p.entries} entr${p.entries === 1 ? "y" : "ies"}`}
                    </small>
                  </td>
                  <td>{time(p.minutes)}</td>
                  <td>{bdt(p.cost)}</td>
                  <td>
                    <IncomeCell project={p} busy={busy} send={send} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!projects.length && <div className="pay-empty">No projects match these filters.</div>}
        </div>
      </section>

      <section className="pay-panel">
        <h2>Clients · {periodName}</h2>
        <div className="pay-table">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Projects</th>
                <th>Workers</th>
                <th>Hours</th>
                <th>Worker cost</th>
                <th>Client paid</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.map(([name, c]) => (
                <tr key={name}>
                  <td>
                    <b>{name || "No client"}</b>
                  </td>
                  <td>{c.projects}</td>
                  <td>{[...c.workers].filter(Boolean).join(", ")}</td>
                  <td>{time(c.minutes)}</td>
                  <td>{bdt(c.cost)}</td>
                  <td>{c.income ? usd(c.income) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!clientRows.length && <div className="pay-empty">No client work in this period.</div>}
        </div>
      </section>

      <section className="pay-panel">
        <div className="pay-toolbar">
          <div>
            <p className="pay-eyebrow">COMPANY SPEND · USD</p>
            <h2>Expenses · {periodName}</h2>
          </div>
          <button
            className="pay-primary"
            onClick={() => {
              setExpenseId(crypto.randomUUID());
              setAddingExpense(!addingExpense);
            }}
          >
            + Add expense
          </button>
        </div>
        {addingExpense && (
          <form
            key={expenseId}
            className="pay-gridform pay-entry"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await send(
                  {
                    action: "saveExpense",
                    id: expenseId,
                    version: 0,
                    date: f.get("date"),
                    category: f.get("category"),
                    description: String(f.get("description") || ""),
                    usd: Math.round(Number(f.get("usd")) * 100),
                  },
                  "Expense saved.",
                )
              )
                setAddingExpense(false);
            }}
          >
            <label>
              Date
              <input name="date" type="date" defaultValue={day()} required />
            </label>
            <label>
              Category
              <input name="category" list="expense-categories" maxLength={60} required placeholder="AI tools" />
            </label>
            <datalist id="expense-categories">
              {[...new Set([...CATEGORIES, ...data.expenses.map((x) => x.category)])].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <label>
              Amount (USD)
              <input name="usd" type="number" min="0.01" max="1000000" step="0.01" required />
            </label>
            <label className="pay-wide">
              Description
              <input name="description" maxLength={300} placeholder="e.g. Kling AI monthly plan, 80 Connects" />
            </label>
            <div className="pay-actions pay-wide">
              <button className="pay-primary" disabled={busy}>
                Save expense
              </button>
              <button type="button" onClick={() => setAddingExpense(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {summary.byCategory.length > 0 && (
          <div className="pay-co-cats">
            {summary.byCategory.map(([c, v]) => (
              <span key={c}>
                {c} <b>{usd(v)}</b>
              </span>
            ))}
          </div>
        )}
        <div className="pay-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.expenses
                .filter((x) => inPeriod(x.date))
                .map((x) => (
                  <tr key={x.id} className={x.voided ? "pay-void" : ""}>
                    <td>{x.date}</td>
                    <td>
                      <b>{x.category}</b>
                      {x.voided && <small>Voided — excluded from totals</small>}
                    </td>
                    <td>{x.description}</td>
                    <td>{usd(x.usd)}</td>
                    <td>
                      {!x.voided && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            confirm("Void this expense? It stays in history but is excluded from totals.") &&
                            void send({ action: "voidExpense", id: x.id, version: x.version }, "Expense voided.")
                          }
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!data.expenses.some((x) => inPeriod(x.date)) && (
            <div className="pay-empty">No expenses in this period. Add AI tools, Upwork Connects and other spend here.</div>
          )}
        </div>
      </section>
    </>
  );
}

function IncomeCell({
  project,
  busy,
  send,
}: {
  project: Project;
  busy: boolean;
  send: (body: object, done?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button className="pay-link" onClick={() => setEditing(true)}>
        {project.clientPaidUsd ? usd(project.clientPaidUsd) : "+ Add"}
      </button>
    );
  return (
    <form
      className="pay-inline"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get("usd") || "").trim();
        if (
          await send(
            { action: "projectIncome", id: project.id, version: project.version, usd: v ? Math.round(Number(v) * 100) : null },
            "Client payment saved.",
          )
        )
          setEditing(false);
      }}
    >
      <input
        name="usd"
        type="number"
        min="0"
        step="0.01"
        aria-label="Client paid (USD)"
        placeholder="USD"
        autoFocus
        defaultValue={project.clientPaidUsd ? project.clientPaidUsd / 100 : ""}
      />
      <button className="pay-primary" disabled={busy}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)}>
        ✕
      </button>
    </form>
  );
}
