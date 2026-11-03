import { durableObjectState } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBudget } from "../../web/worker/budget.ts";
import worker from "../../web/worker/index.ts";

const EXT_ORIGIN = "chrome-extension://kpfmcjoapodehdolgeohbpbickdmejko";

let env: Env;
let rateLimitOk: boolean;
let upstream: ReturnType<typeof vi.fn>;

function makeEnv(overrides: Partial<Record<string, string>> = {}): Env {
  const ledger = new DemoBudget(durableObjectState() as never, {} as Env);
  return {
    ASSEMBLYAI_API_KEY: "secret-key",
    MAX_SESSION_SECONDS: "120",
    DAILY_CAP_SECONDS: "240",
    EXT_MAX_SESSION_SECONDS: "180",
    EXT_DAILY_CAP_SECONDS: "360",
    ASSETS: { fetch: vi.fn(async () => new Response("<html>")) },
    DEMO_RL: { limit: vi.fn(async () => ({ success: rateLimitOk })) },
    DEMO_BUDGET: { idFromName: () => "global", get: () => ledger },
    ...overrides,
  } as unknown as Env;
}

function call(path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.7");
  return worker.fetch(new Request(`https://aalto.test${path}`, { ...init, headers }), env);
}

beforeEach(() => {
  rateLimitOk = true;
  env = makeEnv();
  upstream = vi.fn(async () => Response.json({ token: "single-use" }));
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => vi.unstubAllGlobals());

describe("static site", () => {
  it("serves non-API paths from assets", async () => {
    const res = await call("/");
    expect(await res.text()).toBe("<html>");
  });
});

describe("token minting", () => {
  it("mints a demo token with a lease and the session cap", async () => {
    const res = await call("/api/demo/token", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      token: "single-use",
      leaseId: expect.any(String),
      maxSessionSeconds: 120,
    });
    const url = new URL(upstream.mock.calls[0][0]);
    expect(url.searchParams.get("max_session_duration_seconds")).toBe("120");
    expect(upstream.mock.calls[0][1].headers.authorization).toBe("secret-key");
  });

  it("refuses with 429 burst when rate limited, before touching upstream", async () => {
    rateLimitOk = false;
    const res = await call("/api/demo/token", { method: "POST" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ reason: "burst" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refunds the budget and says upstream when AssemblyAI refuses", async () => {
    upstream.mockResolvedValue(new Response("bad key secret-key", { status: 401 }));
    const res = await call("/api/demo/token", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toBe('{"reason":"upstream"}');
    const status = await (await call("/api/demo/status")).json();
    expect(status.remainingSeconds).toBe(240);
  });

  it("gives up on a hung upstream instead of holding the request open", async () => {
    upstream.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal.reason))
        )
    );
    // Only timers are faked: hashing the visitor resolves off the fake clock,
    // so wait until the mint is actually in flight before moving time on.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = call("/api/demo/token", { method: "POST" });
    while (upstream.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(8_000);
    vi.useRealTimers();
    expect((await pending).status).toBe(503);
  });

  it("keeps the demo and extension budgets separate", async () => {
    // Spend the whole demo cap from two visitors...
    await call("/api/demo/token", { method: "POST", ip: "198.51.100.1" });
    await call("/api/demo/token", { method: "POST", ip: "198.51.100.2" });
    const spent = await call("/api/demo/token", { method: "POST", ip: "198.51.100.3" });
    expect(await spent.json()).toEqual({ reason: "daily_limit" });
    // ...and the extension still has its own.
    const ext = await call("/api/ext/token", { headers: { Origin: EXT_ORIGIN } });
    expect(ext.status).toBe(200);
  });

  it.each([
    ["missing", undefined],
    ["non-numeric", "lots"],
    ["negative", "-5"],
  ])("fails closed when the cap is %s", async (_label, value) => {
    env = makeEnv({ DAILY_CAP_SECONDS: value });
    const res = await call("/api/demo/token", { method: "POST" });
    expect(res.status).toBe(500);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("CORS", () => {
  it("allows the pinned extension origin only", async () => {
    const ext = await call("/api/ext/token", { headers: { Origin: EXT_ORIGIN } });
    expect(ext.headers.get("access-control-allow-origin")).toBe(EXT_ORIGIN);
    expect(ext.headers.get("vary")).toBe("Origin");

    const other = await call("/api/ext/token", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

it("treats a zero cap as the demo switched off", async () => {
  env = makeEnv({ DAILY_CAP_SECONDS: "0" });
  const res = await call("/api/demo/token", { method: "POST" });
  expect(await res.json()).toEqual({ reason: "daily_limit" });
});

describe("release", () => {
  async function mintLease(ip = "203.0.113.7") {
    const res = await call("/api/demo/token", { method: "POST", ip });
    return (await res.json()).leaseId as string;
  }

  it("frees the visitor's slot", async () => {
    env = makeEnv({ DAILY_CAP_SECONDS: "10000" });
    const a = await mintLease();
    await mintLease();
    expect((await call("/api/demo/token", { method: "POST" })).status).toBe(429);
    await call("/api/demo/release", { method: "POST", body: JSON.stringify({ leaseId: a }) });
    expect((await call("/api/demo/token", { method: "POST" })).status).toBe(200);
  });

  it.each([
    ["not JSON", "{oops"],
    ["a number", JSON.stringify({ leaseId: 42 })],
    ["an object", JSON.stringify({ leaseId: { $ne: null } })],
    ["not a uuid", JSON.stringify({ leaseId: "x".repeat(5000) })],
  ])("answers ok and does nothing for a body that is %s", async (_label, body) => {
    const res = await call("/api/demo/release", { method: "POST", body });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("routing", () => {
  it("404s unknown API paths as JSON", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("reports health", async () => {
    expect(await (await call("/api/health")).json()).toEqual({ ok: true, version: "1.0.0" });
  });
});
