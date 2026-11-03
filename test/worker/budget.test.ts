import { durableObjectState } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBudget } from "../../web/worker/budget.ts";

const DAY = "2026-11-03";
let ledger: DemoBudget;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${DAY}T12:00:00Z`));
  ledger = new DemoBudget(durableObjectState() as never, {} as Env);
});
afterEach(() => vi.useRealTimers());

describe("DemoBudget", () => {
  it("grants a lease and charges the full session up front", () => {
    const lease = ledger.mint("v1", DAY, 120, 600);
    expect(lease).toMatchObject({ ok: true, seconds: 120 });
    expect(lease.leaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ledger.status(DAY, 600)).toEqual({
      remainingSeconds: 480,
      dailyCapSeconds: 600,
      activeSessions: 1,
    });
  });

  it("refuses a mint that would cross the daily cap", () => {
    ledger.mint("v1", DAY, 300, 600);
    ledger.mint("v2", DAY, 300, 600);
    expect(ledger.mint("v3", DAY, 120, 600)).toEqual({ ok: false, reason: "daily_limit" });
  });

  it("allows two concurrent sessions per visitor, not three", () => {
    ledger.mint("v1", DAY, 60, 6000);
    ledger.mint("v1", DAY, 60, 6000);
    expect(ledger.mint("v1", DAY, 60, 6000)).toEqual({ ok: false, reason: "active_session" });
    expect(ledger.mint("v2", DAY, 60, 6000).ok).toBe(true);
  });

  it("release frees the slot but never refunds the seconds", () => {
    const a = ledger.mint("v1", DAY, 60, 6000);
    ledger.mint("v1", DAY, 60, 6000);
    ledger.release(a.leaseId as string);
    expect(ledger.mint("v1", DAY, 60, 6000).ok).toBe(true);
    expect(ledger.status(DAY, 6000).remainingSeconds).toBe(6000 - 180);
  });

  it("cancel refunds a lease whose upstream mint failed, once", () => {
    const lease = ledger.mint("v1", DAY, 120, 600);
    ledger.cancel(lease.leaseId as string, DAY);
    ledger.cancel(lease.leaseId as string, DAY);
    expect(ledger.status(DAY, 600)).toMatchObject({ remainingSeconds: 600, activeSessions: 0 });
  });

  it("sweeps expired leases without refunding them", () => {
    ledger.mint("v1", DAY, 60, 6000);
    ledger.mint("v1", DAY, 60, 6000);
    vi.advanceTimersByTime(60_000 + 10_001);
    expect(ledger.mint("v1", DAY, 60, 6000).ok).toBe(true);
    expect(ledger.status(DAY, 6000)).toMatchObject({ activeSessions: 1, remainingSeconds: 5820 });
  });

  it("keeps separate pools apart", () => {
    ledger.mint("v1", DAY, 500, 500);
    expect(ledger.mint("v2", `ext:${DAY}`, 100, 500).ok).toBe(true);
  });

  it("prunes budget rows older than a month", () => {
    ledger.mint("v1", "2026-09-01", 60, 600);
    ledger.mint("v1", `ext:2026-09-01`, 60, 600);
    ledger.status(DAY, 600);
    const rows = ledger.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM budget").one().n;
    expect(rows).toBe(0);
  });
});
