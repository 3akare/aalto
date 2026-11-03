/**
 * Serves the page and mints session tokens under a budget. That is all of it -
 * the audio socket is browser-to-AssemblyAI, so nothing here is on the hot path
 * of a conversation.
 */

import { DemoBudget } from "./budget.js";
import { hashVisitor, today } from "./iphash.js";
import { mintToken } from "./token.js";

export { DemoBudget };

/** The extension's pinned ID - see extension/manifest.json's `key`. */
const EXTENSION_ORIGIN = "chrome-extension://kpfmcjoapodehdolgeohbpbickdmejko";

const LEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A setting the Worker cannot run safely without. Reported as a plain 500. */
class ConfigError extends Error {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      const response = await route(request, env, url);
      return withCors(response, request);
    } catch (err) {
      console.error(err);
      return withCors(json({ error: "something went wrong" }, 500), request);
    }
  },
};

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  switch (`${request.method} ${url.pathname}`) {
    case "GET /api/health":
      return json({ ok: true, version: "1.0.0" });

    case "GET /api/demo/status":
      return await status(env, false);

    case "POST /api/demo/token":
      return await token(request, env, false);

    case "POST /api/demo/release":
      return await release(request, env);

    // A GET with no custom headers, so there is no preflight to get wrong.
    case "GET /api/ext/token":
      return await token(request, env, true);

    case "OPTIONS /api/demo/token":
    case "OPTIONS /api/demo/release":
      return new Response(null, { status: 204 });

    default:
      return json({ error: "no such endpoint" }, 404);
  }
}

// --- handlers ---------------------------------------------------------------

/**
 * Validated, because these fail OPEN: a missing cap is NaN, `granted + seconds
 * > NaN` is false, and every mint would be granted. A bad setting refuses all
 * minting instead. A zero cap is valid - it switches that endpoint off.
 */
function limits(env: Env, forExtension: boolean) {
  const [sessionVar, capVar] = forExtension
    ? (["EXT_MAX_SESSION_SECONDS", "EXT_DAILY_CAP_SECONDS"] as const)
    : (["MAX_SESSION_SECONDS", "DAILY_CAP_SECONDS"] as const);
  const seconds = Number(env[sessionVar]);
  const dailyCap = Number(env[capVar]);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new ConfigError(`${sessionVar} is invalid`);
  if (!Number.isInteger(dailyCap) || dailyCap < 0) throw new ConfigError(`${capVar} is invalid`);
  return { seconds, dailyCap };
}

/**
 * The ledger row a mint is charged to. The demo and the extension have
 * separate caps, so they need separate rows - sharing one let the demo spend
 * the extension's allowance and the reverse. The demo keeps the bare date it
 * has always used, so the live ledger keeps today's count across a deploy.
 */
function pool(forExtension: boolean): string {
  return forExtension ? `ext:${today()}` : today();
}

/** One ledger for everyone: the daily cap is a total across visitors. */
function ledger(env: Env) {
  return env.DEMO_BUDGET.get(env.DEMO_BUDGET.idFromName("global"));
}

async function status(env: Env, forExtension: boolean): Promise<Response> {
  const { dailyCap } = limits(env, forExtension);
  const state = await ledger(env).status(pool(forExtension), dailyCap);
  return json({ ...state, mode: state.remainingSeconds > 0 ? "live" : "replay" });
}

/** Cheap shield, then ledger, then upstream - minting first would spend a
 *  token on a request the budget was about to refuse. */
async function token(request: Request, env: Env, forExtension: boolean): Promise<Response> {
  const { seconds, dailyCap } = limits(env, forExtension);
  // Read once: a refund must hit the same row even if the mint straddles midnight.
  const day = pool(forExtension);
  const visitor = await hashVisitor(request, env.ASSEMBLYAI_API_KEY);

  const { success } = await env.DEMO_RL.limit({ key: visitor });
  if (!success) return json({ reason: "burst" }, 429);

  const lease = await ledger(env).mint(visitor, day, seconds, dailyCap);
  if (!lease.ok || !lease.leaseId) return json({ reason: lease.reason ?? "daily_limit" }, 429);
  const leaseId = lease.leaseId;

  try {
    const token = await mintToken(env.ASSEMBLYAI_API_KEY, seconds);
    return json({ token, leaseId, maxSessionSeconds: seconds });
  } catch (err) {
    // Give the seconds back rather than charging for a session that never
    // opened - otherwise an upstream outage silently eats the day's budget.
    await ledger(env).cancel(leaseId, day);
    console.error("mint failed:", err);
    // A named reason and its own status, so the page can say what actually
    // happened. Falling through to the generic 500 meant an upstream failure
    // and a missing key both reported to the user as rate limiting.
    return json({ reason: "upstream" }, 503);
  }
}

/** Arrives via sendBeacon, which sets its own content type - so the body is
 *  parsed as text, and a parse failure is not worth a 400 to a client that has
 *  already navigated away. */
async function release(request: Request, env: Env): Promise<Response> {
  let leaseId: unknown;
  try {
    leaseId = JSON.parse(await request.text())?.leaseId;
  } catch {
    return json({ ok: true });
  }
  // Frees the slot so this visitor can start again. It does not give the
  // seconds back - see the note on release(). Anything but a lease id the
  // ledger could have issued never reaches it.
  if (typeof leaseId === "string" && LEASE_ID.test(leaseId)) await ledger(env).release(leaseId);
  return json({ ok: true });
}

// --- plumbing ---------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // no-store: a cached token is a token already spent.
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** For the extension only - the demo is same-origin. Its ID is pinned in the
 *  manifest precisely so there is a fixed origin to allow. */
function withCors(response: Response, request: Request): Response {
  const origin = request.headers.get("Origin");
  if (origin !== EXTENSION_ORIGIN) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
