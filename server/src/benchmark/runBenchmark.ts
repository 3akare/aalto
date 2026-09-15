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
const DOCS_DIR = path.join(ROOT, "docs");

const TRACKS: Track[] = ["A", "B", "C"];
const BOOTSTRAP_ITERATIONS = 10_000;

/**
 * Per-provider ceilings, requests per minute.
 *
 * Intron documents 30/min. The Gemini figures are the free tier's, which is what
 * a 429 "exceeded your current quota" on the first burst was telling us; leaving
 * them unthrottled means most of the run records vendor failures that say more
 * about our billing plan than about the model.
 */
const RATE_LIMITS: Record<string, number> = {
  intron: 30,
  "gemini-transcribe": 4,
  "gemini-flash": 4,
};

/**
 * Intron loads a speech model per language on demand, and answers the first
 * request for a cold language with "Required language not available for this
 * session, please wait 30 seconds".
 *
 * The runner would retry through that, but each retry burns a full session
 * timeout on a multi-minute clip, so a cold start can cost twenty minutes before
 * the first real result. Warming each language once up front with its shortest
 * clip turns that into a few seconds of setup.
 */
async function warmIntronLanguages(
  provider: SttProvider,
  byLanguage: Map<string, { id: string; audio: () => Buffer }>
): Promise<void> {
  for (const [language, sample] of byLanguage) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await provider.transcribe(sample.audio(), { languageCode: language });
        console.log(`[benchmark] warmed ${language}`);
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/required language not available/i.test(message)) {
          console.log(`[benchmark] warm ${language}: ${message.slice(0, 70)}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 35_000));
      }
    }
  }
}

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
    // The generalist multimodal model is off by default. Against AfriSwitchCare
    // it returned nothing usable for two separate reasons, both worth reporting
    // but neither leaving anything to score: free-tier quota exhaustion, and
    // "Input blocked" safety refusals on clinical audio - it declines to
    // transcribe patients describing their own symptoms. A system that returns no
    // transcript cannot be compared on word error rate, and including it would
    // empty the complete-case intersection and with it every table in the report.
    // Set GEMINI_INCLUDE_GENERALIST=true to put it back.
    if (process.env.GEMINI_INCLUDE_GENERALIST === "true") {
      providers.push(
        new GeminiSttProvider(config.gemini.apiKey, {
          kind: "generalist",
          model: config.gemini.plannerModel,
        })
      );
    }
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
  entity: ErrorCounts[];
  entityNumber: ErrorCounts[];
  entityName: ErrorCounts[];
  spansDeleted: number;
  spansTotal: number;
  latencies: number[];
  retries: number;
  failures: number;
  emptyTranscripts: number;
}

async function main(): Promise<void> {
  const tier = process.argv[2] ?? "smoke";
  const datasetKey = (process.argv[3] ?? "afriswitch").toLowerCase();
  const manifestPath = path.join(MANIFEST_DIR, `${datasetKey}-${tier}.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No manifest at ${manifestPath}. Run \`npm run corpus -- ${tier} ${datasetKey}\` first, and COMMIT the ` +
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

  const intron = providers.find((p) => p.id === "intron");
  if (intron) {
    const hasUncached = rows.some((r) => !runner.isCached(intron, r.id, hash));
    if (hasUncached) {
      const shortestPerLanguage = new Map<string, { id: string; audio: () => Buffer }>();
      for (const r of [...rows].sort((a, b) => a.duration - b.duration)) {
        if (!shortestPerLanguage.has(r.language)) {
          shortestPerLanguage.set(r.language, {
            id: r.id,
            audio: () => readFileSync(path.join(SAMPLES_DIR, `${r.id}.wav`)),
          });
        }
      }
      console.log(`[benchmark] warming ${shortestPerLanguage.size} language model(s) ...`);
      await warmIntronLanguages(intron, shortestPerLanguage);
    } else {
      console.log("[benchmark] all Intron requests cached, skipping language warmup.");
    }
  }

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
        if (done % 4 === 0 || done === total) {
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
      entity: [],
      entityNumber: [],
      entityName: [],
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
          s.entity.push(m.entity);
          s.entityNumber.push(m.entityNumber);
          s.entityName.push(m.entityName);
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
    entity: [],
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

    input.entity.push({
      providerId: p.id,
      overall: bootstrapCI(pick(s.entity), coreStrata, { iterations: BOOTSTRAP_ITERATIONS }),
      numbers: rate(pick(s.entityNumber).reduce(addCounts, ZERO)),
      names: rate(pick(s.entityName).reduce(addCounts, ZERO)),
      numberTokens: pick(s.entityNumber).reduce(addCounts, ZERO).N,
      nameTokens: pick(s.entityName).reduce(addCounts, ZERO).N,
    });

    const supportedLangs = languages.filter((l) => p.supportedLanguages.has(l));
    input.headline.push({
      providerId: p.id,
      werA: ciA,
      werB: ciB,
      diacriticTax: ciA.point - ciB.point,
      macroCoreA: macroAverage(s.counts.A, strata, coreLanguages),
      macroAllA: macroAverage(s.counts.A, strata, supportedLangs),
      supportedCount: supportedLangs.length,
      coverage: `${supportedLangs.length}/${languages.length}`,
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
  // The report IS a required submission document, so write it where the other
  // submission documents live rather than making someone copy it across.
  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(path.join(DOCS_DIR, "BENCHMARK_REPORT.md"), markdown);

  console.log(`\n[benchmark] wrote ${path.join(RESULTS_DIR, "latest.md")}`);
  console.log(`[benchmark] wrote ${path.join(DOCS_DIR, "BENCHMARK_REPORT.md")}`);
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
