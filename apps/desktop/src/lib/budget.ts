export type BudgetState = "ok" | "warn" | "paused";

/// Where spend stands against a budget: the same lines the backend draws, 80%
/// warns and 100% pauses. No budget never pauses.
export function budgetState(spent: number, budget: number | null): BudgetState {
  if (budget === null || budget <= 0) return "ok";
  if (spent >= budget) return "paused";
  if (spent >= budget * 0.8) return "warn";
  return "ok";
}

/// Share of the budget used, 0 to 1.
export function spendShare(spent: number, budget: number | null): number {
  if (budget === null || budget <= 0) return 0;
  return Math.min(1, Math.max(0, spent / budget));
}

/// How many of `total` track segments are lit.
export function litSegments(share: number, total = 40): number {
  return Math.round(share * total);
}

/// "12.40" for dollars; a budget that is whole shows no cents.
export function usd(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/// What the budget field accepts: a positive number. `null` for anything else.
export function parseBudget(raw: string): number | null {
  const n = Number(raw.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
