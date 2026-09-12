import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { AssemblyAiSttProvider } from "../stt/assemblyai";
import { GeminiSttProvider } from "../stt/gemini";
import { INTRON_SUPPORTED } from "../stt/intron";
import { IntronStreamSttProvider } from "../stt/intronStream";
import type { SttProvider } from "../stt/types";
import { addCounts, type ErrorCounts, rate, scoreUtterance, ZERO } from "./metrics";
import { normalizeReference, normalizeText, type Track } from "./normalize";
import type { Manifest } from "./prepareCorpus";
import { type ReportInput, renderReport } from "./report";
import { BenchmarkRunner, completeCases } from "./runner";
import {
  bootstrapCI,
  holmBonferroni,
  kendallTau,
  pairedBootstrapCI,
  pairedPermutationTest,
  weightedSlope,
  winLossTie,
} from "./stats";

const ROOT = path.resolve(__dirname, "../../..");
const SAMPLES_DIR = path.join(ROOT, "benchmark/audio-samples");
const MANIFEST_DIR = path.join(ROOT, "benchmark/manifest");
const RESULTS_DIR = path.join(ROOT, "benchmark/results");
const CACHE_DIR = path.join(ROOT, "benchmark/cache/responses");

const TRACKS: Track[] = ["A", "B", "C"];
const BOOTSTRAP_ITERATIONS = 10_000;

/** Intron documents 30 requests/minute. This is the critical path for the whole run. */
const RATE_LIMITS: Record<string, number> = { intron: 30 };

function buildProviders(): SttProvider[] {
  const providers: SttProvider[] = [
    // Streaming, not the sync endpoint: sync rejects anything over ~5s on this
    // account with a spurious "insufficient balance", and AfriSwitch utterances
    // average ~12s. Disclosed in the report - it is Intron's production path, but
    // it is a different endpoint class from the others' batch APIs.
    new IntronStreamSttProvider(config.intron.apiKey, INTRON_SUPPORTED),
  ];
  if (config.assemblyai.apiKey) {
    providers.push(new AssemblyAiSttProvider(config.assemblyai.apiKey));
  }
  if (config.gemini.apiKey) {
    providers.push(
      new GeminiSttProvider(config.gemini.apiKey, {
        kind: "transcribe",
        model: config.gemini.transcribeModel,
      })
    );
    providers.push(
      new GeminiSttProvider(config.gemini.apiKey, {
        kind: "generalist",
        model: config.gemini.plannerModel,
      })
    );
  }
  if (providers.length < 3) {
    throw new Error(
      `Only ${providers.length} provider(s) configured. The Sahara rules require a benchmark ` +
        `across 3+ speech models including a Sahara API - set ASSEMBLYAI_API_KEY and GEMINI_API_KEY.`
    );
  }
  return providers;
}

/**
 * Hash of everything that affects a request, so the response cache invalidates
 * when the protocol changes rather than silently serving stale transcripts.
 */
function configHashFor(useLanguageHint: boolean): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, useLanguageHint, rawAsr: true, audio: "wav16k-mono-pcm16" }))
    .digest("hex")
    .slice(0, 16);
}

interface Scored {
  /** Per-utterance counts, in manifest order, per track. */
  counts: Record<Track, ErrorCounts[]>;
  english: ErrorCounts[];
  matrix: ErrorCounts[];
  switchNear: ErrorCounts[];
  switchFar: ErrorCounts[];
  spansDeleted: number;
  spansTotal: number;
  latencies: number[];
  retries: number;
  failures: number;
  emptyTranscripts: number;
}

async function main(): Promise<void> {
  const tier = process.argv[2] ?? "smoke";
  const manifestPath = path.join(MANIFEST_DIR, `afriswitch-sample-${tier}.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No manifest at ${manifestPath}. Run \`npm run corpus -- ${tier}\` first, and COMMIT the ` +
        `manifest before running the benchmark - that commit is the pre-registration record.`
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const rows = manifest.rows.filter((r) => existsSync(path.join(SAMPLES_DIR, `${r.id}.wav`)));
  if (rows.length === 0) throw new Error(`No audio found in ${SAMPLES_DIR} for this manifest.`);

  const providers = buildProviders();
  const hash = configHashFor(true);

  console.log(`[benchmark] tier=${tier}  utterances=${rows.length}  providers=${providers.length}`);
  console.log(`[benchmark] models: ${providers.map((p) => `${p.id}(${p.modelId})`).join(", ")}`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const runner = new BenchmarkRunner({ cacheDir: CACHE_DIR, rateLimits: RATE_LIMITS });

  const results = await runner.runAll(
    providers,
    rows.map((r) => ({
      id: r.id,
      languageCode: r.language,
      audio: () => readFileSync(path.join(SAMPLES_DIR, `${r.id}.wav`)),
    })),
    hash,
    {
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) {
          process.stdout.write(`\r[benchmark] ${done}/${total} calls`);
        }
      },
    }
  );
  process.stdout.write("\n");

  const complete = completeCases(
    results,
    rows.map((r) => r.id)
  );
  console.log(
    `[benchmark] complete-case intersection: ${complete.length}/${rows.length} utterances`
  );
  const scoredRows = rows.filter((r) => complete.includes(r.id));

  // --- Score every provider on every track ---------------------------------
  const scored = new Map<string, Scored>();

  for (const provider of providers) {
    const s: Scored = {
      counts: { A: [], B: [], C: [] },
      english: [],
      matrix: [],
      switchNear: [],
      switchFar: [],
      spansDeleted: 0,
      spansTotal: 0,
      latencies: [],
      retries: 0,
      failures: 0,
      emptyTranscripts: 0,
    };

    const all = results.get(provider.id);
    for (const [, outcome] of all ?? []) {
      s.retries += outcome.retryCount;
      if (!outcome.ok) s.failures++;
    }

    for (const row of scoredRows) {
      const outcome = all?.get(row.id);
      const hypothesis = outcome?.result?.transcript ?? "";
      if (!hypothesis.trim()) s.emptyTranscripts++;
      if (outcome?.result?.latencyMs) s.latencies.push(outcome.result.latencyMs);

      for (const track of TRACKS) {
        const opts = { track, languageCode: row.language };
        const reference = normalizeReference(row.transcriptionTagged || row.transcription, opts);
        const hyp = normalizeText(hypothesis, opts);
        const m = scoreUtterance(reference, hyp);
        s.counts[track].push(m.counts);

        // Code-switching metrics are reported on the primary track only.
        if (track === "A") {
          s.english.push(m.english);
          s.matrix.push(m.matrix);
          s.switchNear.push(m.switchNear);
          s.switchFar.push(m.switchFar);
          s.spansDeleted += m.englishSpansDeleted;
          s.spansTotal += m.englishSpansTotal;
        }
      }
    }
    scored.set(provider.id, s);
  }

  // --- Aggregate ------------------------------------------------------------
  const strata = scoredRows.map((r) => r.language);
  const cmis = scoredRows.map((r) => r.cmi);
  const languages = [...new Set(strata)].sort();

  /** CORE-n: languages every configured vendor claims to support. */
  const coreLanguages = languages.filter((l) =>
    providers.every((p) => p.supportedLanguages.has(l))
  );
  console.log(
    `[benchmark] CORE set: ${coreLanguages.length}/${languages.length} languages ` +
      `(${coreLanguages.join(", ") || "none"})`
  );

  const coreMask = scoredRows.map((r) => coreLanguages.includes(r.language));
  const pick = <T>(arr: T[]) => arr.filter((_, i) => coreMask[i]);

  const input: ReportInput = {
    manifest,
    tier,
    generatedAt: new Date().toISOString(),
    utterances: scoredRows.length,
    totalUtterances: rows.length,
    languages,
    coreLanguages,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      modelId: p.modelId,
      coverage: languages.filter((l) => p.supportedLanguages.has(l)).length,
      totalLanguages: languages.length,
    })),
    headline: [],
    perLanguage: [],
    pairwise: [],
    rankingStability: [],
    codeSwitching: [],
    robustness: [],
  };

  for (const p of providers) {
    const s = scored.get(p.id);
    if (!s) continue;
    const coreA = pick(s.counts.A);
    const coreB = pick(s.counts.B);
    const coreStrata = pick(strata);

    const ciA = bootstrapCI(coreA, coreStrata, { iterations: BOOTSTRAP_ITERATIONS });
    const ciB = bootstrapCI(coreB, coreStrata, { iterations: BOOTSTRAP_ITERATIONS });

    input.headline.push({
      providerId: p.id,
      werA: ciA,
      werB: ciB,
      diacriticTax: ciA.point - ciB.point,
      macroA: macroAverage(s.counts.A, strata, coreLanguages),
      coverage: `${languages.filter((l) => p.supportedLanguages.has(l)).length}/${languages.length}`,
    });

    const englishRate = rate(pick(s.english).reduce(addCounts, ZERO));
    const matrixRate = rate(pick(s.matrix).reduce(addCounts, ZERO));
    const nearRate = rate(pick(s.switchNear).reduce(addCounts, ZERO));
    const farRate = rate(pick(s.switchFar).reduce(addCounts, ZERO));

    input.codeSwitching.push({
      providerId: p.id,
      werMatrix: matrixRate,
      werEnglish: englishRate,
      ratio: matrixRate === 0 ? Number.NaN : englishRate / matrixRate,
      sper: nearRate,
      nonSper: farRate,
      switchPenalty: nearRate - farRate,
      spanDeletionRate: s.spansTotal === 0 ? 0 : s.spansDeleted / s.spansTotal,
      cmiSlope: weightedSlope(pick(s.counts.A), pick(cmis)),
    });

    const sortedLat = [...s.latencies].sort((a, b) => a - b);
    input.robustness.push({
      providerId: p.id,
      failures: s.failures,
      retries: s.retries,
      emptyTranscripts: s.emptyTranscripts,
      p50LatencyMs: percentile(sortedLat, 0.5),
      p95LatencyMs: percentile(sortedLat, 0.95),
    });

    for (const lang of languages) {
      const mask = scoredRows.map((r) => r.language === lang);
      const langCounts = s.counts.A.filter((_, i) => mask[i]);
      input.perLanguage.push({
        providerId: p.id,
        language: lang,
        supported: p.supportedLanguages.has(lang),
        wer: bootstrapCI(
          langCounts,
          langCounts.map(() => lang),
          { iterations: 2000 }
        ),
        n: langCounts.length,
      });
    }
  }

  // Pairwise comparisons on the CORE set, with Holm correction inside the family.
  const rawP: number[] = [];
  for (let i = 0; i < providers.length; i++) {
    for (let j = i + 1; j < providers.length; j++) {
      const a = scored.get(providers[i].id);
      const b = scored.get(providers[j].id);
      if (!a || !b) continue;
      const ca = pick(a.counts.A);
      const cb = pick(b.counts.A);
      const st = pick(strata);
      const delta = pairedBootstrapCI(ca, cb, st, { iterations: BOOTSTRAP_ITERATIONS });
      const p = pairedPermutationTest(ca, cb, { iterations: BOOTSTRAP_ITERATIONS });
      rawP.push(p);
      input.pairwise.push({
        a: providers[i].id,
        b: providers[j].id,
        delta,
        p,
        pAdjusted: Number.NaN,
        ...winLossTie(ca, cb),
      });
    }
  }
  holmBonferroni(rawP).forEach((adj, i) => {
    input.pairwise[i].pAdjusted = adj;
  });

  // Ranking stability: does the model order survive increasingly severe normalisation?
  const orderFor = (track: Track) =>
    providers
      .map((p) => ({
        id: p.id,
        wer: rate(pick(scored.get(p.id)?.counts[track] ?? []).reduce(addCounts, ZERO)),
      }))
      .sort((x, y) => x.wer - y.wer)
      .map((x) => x.id);

  const ranks: Record<Track, string[]> = { A: orderFor("A"), B: orderFor("B"), C: orderFor("C") };
  const asVector = (order: string[]) => providers.map((p) => order.indexOf(p.id));
  input.rankingStability = [
    {
      pair: "A vs B",
      tau: kendallTau(asVector(ranks.A), asVector(ranks.B)),
      orderA: ranks.A,
      orderB: ranks.B,
    },
    {
      pair: "A vs C",
      tau: kendallTau(asVector(ranks.A), asVector(ranks.C)),
      orderA: ranks.A,
      orderB: ranks.C,
    },
    {
      pair: "B vs C",
      tau: kendallTau(asVector(ranks.B), asVector(ranks.C)),
      orderA: ranks.B,
      orderB: ranks.C,
    },
  ];

  // --- Emit ------------------------------------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(RESULTS_DIR, `raw-${stamp}.json`), JSON.stringify(input, null, 2));
  const markdown = renderReport(input);
  writeFileSync(path.join(RESULTS_DIR, `report-${stamp}.md`), markdown);
  writeFileSync(path.join(RESULTS_DIR, "latest.md"), markdown);

  console.log(`\n[benchmark] wrote ${path.join(RESULTS_DIR, "latest.md")}`);
}

function macroAverage(counts: ErrorCounts[], strata: string[], languages: string[]): number {
  const perLang = languages.map((lang) => {
    const subset = counts.filter((_, i) => strata[i] === lang);
    return subset.length === 0 ? Number.NaN : rate(subset.reduce(addCounts, ZERO));
  });
  const valid = perLang.filter((v) => Number.isFinite(v));
  return valid.length === 0 ? Number.NaN : valid.reduce((a, b) => a + b, 0) / valid.length;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

main().catch((err) => {
  console.error(`\n[benchmark] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
