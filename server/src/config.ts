import "dotenv/config";

const missing: string[] = [];

/**
 * Reads a required env var, collecting failures so startup can report *all* of
 * them at once. The previous version only warned and returned "", which let the
 * process boot with no credentials and then fail later as opaque 500s from axios.
 */
function required(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    missing.push(name);
    return "";
  }
  return val;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  intron: {
    apiKey: required("INTRON_API_KEY"),
    baseUrl: optional("INTRON_BASE_URL", "https://infer.voice.intron.io"),
  },
  assemblyai: { apiKey: optional("ASSEMBLYAI_API_KEY") },
  gemini: {
    apiKey: required("GEMINI_API_KEY"),
    plannerModel: optional("GEMINI_PLANNER_MODEL", "gemini-3.8-flash"),
    transcribeModel: optional("GEMINI_TRANSCRIBE_MODEL", "gemini-3.5-transcribe"),
  },
  huggingface: { token: optional("HF_TOKEN") },
  todoist: { apiToken: required("TODOIST_API_TOKEN") },
  auth: {
    apiKey: optional("AALTO_API_KEY"),
    allowedOrigins: optional("AALTO_ALLOWED_ORIGINS")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  },
};

/**
 * Call once from the server entrypoint. Deliberately NOT called at import time:
 * the benchmark and corpus-prep scripts need a subset of these vars and should
 * not be blocked by, say, a missing Todoist token.
 */
export function assertServerConfig(): void {
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}.\n` +
        `Copy server/.env.example to server/.env and fill them in.`
    );
  }
  if (!config.auth.apiKey) {
    console.warn(
      "[config] AALTO_API_KEY is not set - the API is unauthenticated. Anyone who can reach " +
        `port ${config.port} can spend your API credits and write to your Todoist.`
    );
  }
}

/** Used by the benchmark scripts, which need only a named subset. */
export function assertPresent(vars: Record<string, string>): void {
  const absent = Object.entries(vars)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (absent.length > 0) {
    throw new Error(`Missing required environment variables: ${absent.join(", ")}`);
  }
}
