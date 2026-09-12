import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SttProvider, TranscriptionResult } from "../stt/types";

/**
 * Execution layer for the benchmark: rate limiting, retries, disk caching and
 * round-robin scheduling.
 *
 * Three deliberate choices, each of which is a fairness point in the report:
 *
 *  - ROUND-ROBIN BY UTTERANCE, not per-vendor batches, so a vendor-side incident
 *    or a network blip hits every system equally instead of poisoning one run.
 *  - ONE RETRY POLICY for all vendors, and retries are COUNTED and reported - a
 *    vendor that needs retries is less reliable even when it eventually succeeds.
 *  - DISK CACHE keyed by (model version, utterance, config), written before any
 *    paid call, so a crash four hours in costs neither money nor the day.
 */

export interface RunnerOptions {
  cacheDir: string;
  /** Per-provider ceiling in requests per minute. Intron's is 30. */
  rateLimits?: Record<string, number>;
  maxRetries?: number;
  /** Serial mode for the latency pass: concurrency 1 measures the vendor, not our queueing. */
  serial?: boolean;
}

export interface CallOutcome {
  providerId: string;
  utteranceId: string;
  ok: boolean;
  result?: TranscriptionResult;
  error?: string;
  retryCount: number;
  fromCache: boolean;
}

/** Simple token-bucket limiter, one per provider. */
class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;
  private last = 0;

  constructor(requestsPerMinute: number) {
    this.intervalMs = requestsPerMinute > 0 ? 60_000 / requestsPerMinute : 0;
  }

  acquire(): Promise<void> {
    if (this.intervalMs === 0) return Promise.resolve();
    this.queue = this.queue.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    return this.queue;
  }
}

const RETRYABLE = /(^|\b)(429|5\d\d|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|timed out)\b/i;

export class BenchmarkRunner {
  private limiters = new Map<string, RateLimiter>();
  private opts: Required<Omit<RunnerOptions, "rateLimits">> & {
    rateLimits: Record<string, number>;
  };

  constructor(options: RunnerOptions) {
    this.opts = {
      cacheDir: options.cacheDir,
      rateLimits: options.rateLimits ?? {},
      maxRetries: options.maxRetries ?? 2,
      serial: options.serial ?? false,
    };
    mkdirSync(this.opts.cacheDir, { recursive: true });
  }

  private limiter(providerId: string): RateLimiter {
    let l = this.limiters.get(providerId);
    if (!l) {
      l = new RateLimiter(this.opts.rateLimits[providerId] ?? 0);
      this.limiters.set(providerId, l);
    }
    return l;
  }

  private cachePath(provider: SttProvider, utteranceId: string, configHash: string): string {
    const key = createHash("sha256")
      .update(`${provider.id}|${provider.modelId}|${utteranceId}|${configHash}`)
      .digest("hex")
      .slice(0, 32);
    return path.join(this.opts.cacheDir, `${provider.id}__${key}.json`);
  }

  /** One transcription, with cache, rate limit and retries. Never throws. */
  async call(
    provider: SttProvider,
    utteranceId: string,
    audio: Buffer,
    languageCode: string,
    configHash: string,
    useLanguageHint = true
  ): Promise<CallOutcome> {
    const cacheFile = this.cachePath(provider, utteranceId, configHash);
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as CallOutcome;
        return { ...cached, fromCache: true };
      } catch {
        // Corrupt cache entry - fall through and re-fetch.
      }
    }

    let retryCount = 0;
    let lastError = "";
    const backoffMs = [2000, 8000];

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      await this.limiter(provider.id).acquire();
      try {
        const result = await provider.transcribe(audio, {
          languageCode,
          filename: `${utteranceId}.wav`,
          useLanguageHint,
        });
        const outcome: CallOutcome = {
          providerId: provider.id,
          utteranceId,
          ok: true,
          result: { ...result, retryCount, configHash },
          retryCount,
          fromCache: false,
        };
        writeFileSync(cacheFile, JSON.stringify(outcome), "utf8");
        return outcome;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Retry only on transport-level failures. A 4xx content error is a real
        // result about the vendor, not a blip, and retrying it would hide that.
        if (attempt < this.opts.maxRetries && RETRYABLE.test(lastError)) {
          retryCount++;
          await new Promise((r) =>
            setTimeout(r, backoffMs[Math.min(attempt, backoffMs.length - 1)])
          );
          continue;
        }
        break;
      }
    }

    const outcome: CallOutcome = {
      providerId: provider.id,
      utteranceId,
      ok: false,
      error: lastError,
      retryCount,
      fromCache: false,
    };
    writeFileSync(cacheFile, JSON.stringify(outcome), "utf8");
    return outcome;
  }

  /**
   * Run every provider over every utterance, round-robin by utterance.
   *
   * Within one utterance the providers run concurrently (each throttled by its own
   * limiter); utterances advance in order. In serial mode everything runs one at a
   * time, which is what the latency pass needs.
   */
  async runAll(
    providers: readonly SttProvider[],
    utterances: readonly { id: string; languageCode: string; audio: () => Buffer }[],
    configHash: string,
    opts: { useLanguageHint?: boolean; onProgress?: (done: number, total: number) => void } = {}
  ): Promise<Map<string, Map<string, CallOutcome>>> {
    const byProvider = new Map<string, Map<string, CallOutcome>>();
    for (const p of providers) byProvider.set(p.id, new Map());

    let done = 0;
    const total = utterances.length * providers.length;

    for (const utt of utterances) {
      const audio = utt.audio();
      const tasks = providers.map((p) => async () => {
        const outcome = await this.call(
          p,
          utt.id,
          audio,
          utt.languageCode,
          configHash,
          opts.useLanguageHint ?? true
        );
        byProvider.get(p.id)?.set(utt.id, outcome);
        done++;
        opts.onProgress?.(done, total);
      });

      if (this.opts.serial) {
        for (const t of tasks) await t();
      } else {
        await Promise.all(tasks.map((t) => t()));
      }
    }

    return byProvider;
  }
}

/**
 * Utterances where EVERY system returned a usable response.
 *
 * Primary tables are computed on this intersection. Silently dropping failures
 * per-provider would reward the model that fails on hard audio, since it would
 * then be scored on an easier subset - and it is also what makes the paired
 * significance tests valid, since they require the same utterances on both sides.
 */
export function completeCases(
  results: Map<string, Map<string, CallOutcome>>,
  utteranceIds: readonly string[]
): string[] {
  return utteranceIds.filter((id) => [...results.values()].every((m) => m.get(id)?.ok === true));
}
