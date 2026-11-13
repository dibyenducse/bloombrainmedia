import { ensureProjects } from "./projects";
import { startFresh } from "./fresh-start";
import { totals, type Ledger } from "./store";

// Money units used across the ledger:
//   BDT amounts are integer paisa, USD amounts are integer cents,
//   usdRate is integer paisa per 1 USD (122.50 BDT/USD -> 12250).
export const DEFAULT_USD_RATE = 12200;
export const bdtFromUsd = (usdCents: number, usdRate: number) => Math.round((usdCents * usdRate) / 100);

const dhakaDay = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
export const today = dhakaDay;

export function allWorkers(db: Ledger) {
  db.workers ??= {};
  db.workers.royal ??= { name: "Royal", emailHash: "", opening: db.opening };
  return db.workers;
}

// Admin-only, company-wide view: every worker, project, entry and expense.
export function companyView(db: Ledger) {
  const workers = allWorkers(db);
  startFresh(db);
  for (const id of Object.keys(workers)) ensureProjects(db, id);
  const month = dhakaDay().slice(0, 7);
  const live = db.entries.filter((e) => !e.voided);
  const owner = (workerId?: string) => workerId || "royal";

  const workerRows = Object.entries(workers).map(([id, w]) => {
    const mine = live.filter((e) => owner(e.workerId) === id);
    const t = totals({ opening: w.opening, entries: mine });
    const payments = mine.filter((e) => e.kind === "payment").sort((a, b) => b.date.localeCompare(a.date));
    return {
      id,
      name: w.name,
      active: !!db.users[id],
      hourlyRate: w.hourlyRate ?? 25000,
      settingsVersion: w.settingsVersion ?? 0,
      opening: w.opening,
      balance: t.balance,
      minutes: t.minutes,
      earned: t.earned,
      paid: t.paid,
      monthMinutes: mine.filter((e) => e.kind === "work" && e.date.startsWith(month)).reduce((a, e) => a + e.minutes, 0),
      lastPayment: payments[0] ? { date: payments[0].date, amount: payments[0].amount } : null,
    };
  });

  const projects = (db.projects || []).map((p) => {
    const work = live.filter((e) => e.kind === "work" && e.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date));
    return {
      ...p,
      workerName: workers[p.workerId]?.name || "Unknown worker",
      minutes: work.reduce((a, e) => a + e.minutes, 0),
      cost: work.reduce((a, e) => a + e.amount, 0),
      entries: work.length,
      firstDate: work[0]?.date || null,
      lastDate: work[work.length - 1]?.date || null,
    };
  });

  return {
    company: true as const,
    role: "admin" as const,
    month,
    usdRate: db.settings?.usdRate ?? DEFAULT_USD_RATE,
    workers: workerRows,
    projects,
    entries: live.map((e) => ({
      id: e.id,
      workerId: owner(e.workerId),
      kind: e.kind,
      date: e.date,
      client: e.client,
      projectId: e.projectId || null,
      minutes: e.minutes,
      amount: e.amount,
      usd: e.usd ?? null,
      usdRate: e.usdRate ?? null,
    })),
    expenses: (db.expenses || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    syncedAt: new Date().toISOString(),
  };
}
export type CompanyView = ReturnType<typeof companyView>;
