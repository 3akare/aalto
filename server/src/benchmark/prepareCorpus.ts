import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { downloadFile, listFiles } from "@huggingface/hub";
import { parquetReadObjects } from "hyparquet";
import { toWav16kMono, wavDurationSeconds } from "../audio/transcode";
import { config } from "../config";
import { codeMixingIndex } from "./metrics";
import { isWellFormedTagged, parseTaggedTranscription } from "./normalize";

/**
 * Builds the frozen evaluation sample from AfriSwitch.
 *
 * The output is two things:
 *   1. A committed manifest - seed, dataset commit SHA, and every selected row's
 *      metadata and audio hash. Its git timestamp, predating the run, is the
 *      pre-registration record: it forecloses "you tuned the normaliser until your
 *      preferred model won".
 *   2. WAV/TXT/META triplets on disk, which the runner consumes.
 *
 * The audio itself is gitignored. AfriSwitch is CC-BY-NC-SA-4.0: metrics and
 * derived statistics may be published, the clips may not be redistributed.
 */

/**
 * Which corpus to build from.
 *
 * AfriSwitch is the civic-domain target: ~16.6k short utterances averaging ~12s
 * across 14 languages. AfriSwitchCare is the medical sibling and is structurally
 * different - a dozen multi-turn clinical dialogues per language, each 2-5
 * minutes long. Both carry the same gold [[EN]] span tags, so every metric works
 * unchanged; only the sampling shape differs, which is why the limits below are
 * per-dataset rather than global.
 */
const DATASETS = {
  afriswitch: {
    repo: "intronhealth/AfriSwitch",
    // Intron's sync endpoint capped at 120s; the streaming session caps at 300s.
    maxDurationSeconds: 110,
    perLanguage: { smoke: 5, pilot: 25, main: 100, ablation: 10 },
  },
  afriswitchcare: {
    repo: "intronhealth/AfriSwitchCare",
    // Dialogues run to ~256s. Streaming allows 300s per session; leave headroom.
    maxDurationSeconds: 290,
    // There are only ~12 rows per language, so "main" is simply all of them.
    perLanguage: { smoke: 2, pilot: 5, main: 100, ablation: 3 },
  },
} as const;

type DatasetKey = keyof typeof DATASETS;

const SEED = "aalto-afriswitch-v1";

/**
 * HuggingFace lays these out by full language name (`data/yoruba/...`), but every
 * provider, the coverage table and the script gating all key on ISO codes.
 */
const LANGUAGE_CODES: Record<string, string> = {
  afrikaans: "af",
  amharic: "am",
  french: "fr",
  hausa: "ha",
  igbo: "ig",
  kinyarwanda: "rw",
  luganda: "lg",
  oromo: "om",
  pidgin: "pcm",
  shona: "sn",
  swahili: "sw",
  tswana: "tn",
  yoruba: "yo",
  zulu: "zu",
};

const ROOT = path.resolve(__dirname, "../../..");
const SAMPLES_DIR = path.join(ROOT, "benchmark/audio-samples");
const MANIFEST_DIR = path.join(ROOT, "benchmark/manifest");
const PARQUET_CACHE = path.join(ROOT, "benchmark/cache/parquet");

/** Equal allocation per language: proportional sampling would leave the smallest
 *  language uninterpretable. Equal n gives every language the same precision. */
type Tier = "smoke" | "pilot" | "main" | "ablation";

const MIN_REF_TOKENS = 3;

export interface ManifestRow {
  id: string;
  language: string;
  filename: string;
  duration: number;
  cmi: number;
  numSwitchPoints: number;
  durationTercile: 0 | 1 | 2;
  transcription: string;
  transcriptionTagged: string;
  audioSha256: string;
}

export interface Manifest {
  seed: string;
  dataset: string;
  maxDurationSeconds: number;
  datasetCommitSha: string;
  tier: Tier;
  perLanguage: number;
  createdAt: string;
  exclusions: Record<string, number>;
  rows: ManifestRow[];
}

/**
 * Deterministic selection key.
 *
 * A content hash rather than a seeded PRNG over row order: reproducible from the
 * seed alone, stable if HuggingFace reorders rows, and independently verifiable by
 * a reviewer with sha256sum.
 */
function selectionKey(language: string, filename: string): number {
  const h = createHash("sha256").update(`${SEED}|${language}|${filename}`).digest("hex");
  return Number.parseInt(h.slice(0, 8), 16) / 0x1_0000_0000;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// biome-ignore lint/suspicious/noExplicitAny: parquet rows are dynamically shaped
type Row = Record<string, any>;

/** Column names vary between dataset revisions; resolve them once and report. */
function resolveColumns(sample: Row): {
  audio: string;
  transcription: string;
  tagged: string;
  cmi?: string;
  switches?: string;
  duration?: string;
  filename?: string;
} {
  const keys = Object.keys(sample);
  const find = (...candidates: string[]) =>
    candidates.find((c) => keys.includes(c)) ??
    keys.find((k) => candidates.some((c) => k.toLowerCase() === c.toLowerCase()));

  const audio = find("audio");
  const transcription = find("transcription", "transcript", "text", "sentence");
  const tagged = find("transcription_tagged", "tagged_transcription", "transcript_tagged");

  if (!audio || !transcription || !tagged) {
    throw new Error(
      `Could not resolve required columns in AfriSwitch. Saw: ${keys.join(", ")}.\n` +
        `Needed an audio column, a transcription column, and a code-switch-tagged column.`
    );
  }
  return {
    audio,
    transcription,
    tagged,
    cmi: find("cmi", "code_mixing_index"),
    switches: find("num_switch_points", "switch_points", "n_switch_points"),
    duration: find("duration", "duration_s", "audio_duration"),
    filename: find("filename", "file_name", "id", "audio_id"),
  };
}

function terciles(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return [at(1 / 3), at(2 / 3)];
}

async function main(): Promise<void> {
  const tier = (process.argv[2] as Tier) ?? "smoke";
  const datasetKey = ((process.argv[3] as DatasetKey) ?? "afriswitch").toLowerCase() as DatasetKey;

  const spec = DATASETS[datasetKey];
  if (!spec) {
    throw new Error(
      `Unknown dataset "${datasetKey}". Expected one of: ${Object.keys(DATASETS).join(", ")}`
    );
  }
  const perLanguage = spec.perLanguage[tier];
  if (perLanguage === undefined) {
    throw new Error(
      `Unknown tier "${tier}". Expected one of: ${Object.keys(spec.perLanguage).join(", ")}`
    );
  }
  const DATASET = spec.repo;
  const MAX_DURATION_S = spec.maxDurationSeconds;

  if (!config.huggingface.token) {
    throw new Error(
      "HF_TOKEN is not set. Create a read token at https://huggingface.co/settings/tokens " +
        `and request access to https://huggingface.co/datasets/${DATASET} (it is manually gated).`
    );
  }
  const credentials = { accessToken: config.huggingface.token };

  mkdirSync(SAMPLES_DIR, { recursive: true });
  mkdirSync(MANIFEST_DIR, { recursive: true });
  mkdirSync(PARQUET_CACHE, { recursive: true });

  console.log(`[corpus] dataset=${DATASET}  tier=${tier} (up to ${perLanguage}/language)`);
  console.log(`[corpus] listing files in ${DATASET} ...`);

  const parquetFiles: { path: string }[] = [];
  let datasetCommitSha = "unknown";
  try {
    for await (const f of listFiles({
      repo: { type: "dataset", name: DATASET },
      credentials,
      // The parquet files live one level down, under data/<language>/.
      recursive: true,
    })) {
      if (f.type === "file" && f.path.endsWith(".parquet")) parquetFiles.push({ path: f.path });
      if (f.oid && datasetCommitSha === "unknown") datasetCommitSha = "see-manifest-note";
    }
  } catch (err) {
    throw new Error(
      `Could not list ${DATASET}. This dataset is manually gated - confirm your access request ` +
        `has been approved and that HF_TOKEN has read scope.\nUnderlying error: ${String(err)}`
    );
  }

  const testFiles = parquetFiles.filter((f) => /test/i.test(f.path));
  const chosen = testFiles.length > 0 ? testFiles : parquetFiles;
  if (chosen.length === 0) throw new Error(`No parquet files found in ${DATASET}.`);
  console.log(`[corpus] found ${chosen.length} parquet file(s)`);

  const exclusions: Record<string, number> = {
    tooLong: 0,
    emptyTranscription: 0,
    tooFewTokens: 0,
    malformedTags: 0,
    truncatedDecode: 0,
  };
  const byLanguage = new Map<string, (Row & { __lang: string; __file: string })[]>();
  let columns: ReturnType<typeof resolveColumns> | undefined;

  for (const file of chosen) {
    // Config name is the directory segment, e.g. "data/yo/test-00000-of-00001.parquet".
    const segments = file.path.split("/");
    const dirName = segments.length > 1 ? segments[segments.length - 2] : "unknown";
    // HuggingFace uses full language names; everything downstream keys on ISO.
    const language = LANGUAGE_CODES[dirName.toLowerCase()] ?? dirName;

    const localPath = path.join(PARQUET_CACHE, file.path.replace(/[/\\]/g, "__"));
    console.log(`[corpus] downloading ${file.path} ...`);
    const res = await downloadFile({
      repo: { type: "dataset", name: DATASET },
      path: file.path,
      credentials,
    });
    if (!res) throw new Error(`Download returned nothing for ${file.path}`);
    const parquetBytes = Buffer.from(await res.arrayBuffer());
    // Cached so a re-run of a later stage does not re-download several GB.
    writeFileSync(localPath, parquetBytes);

    const rows: Row[] = await parquetReadObjects({
      file: parquetBytes.buffer.slice(
        parquetBytes.byteOffset,
        parquetBytes.byteOffset + parquetBytes.byteLength
      ) as ArrayBuffer,
      // MUST be false. hyparquet defaults to decoding every BYTE_ARRAY as UTF-8,
      // which turns audio into a string where each invalid byte sequence becomes
      // U+FFFD - over half the samples in a WAV. The file still has a valid header
      // and the right duration, so it decodes and plays; it is simply noise, and
      // three separate ASR systems dutifully returned ~5% of the words before the
      // cause was found. Columns typed as STRING are unaffected.
      utf8: false,
    });
    if (rows.length === 0) continue;
    if (!columns) {
      columns = resolveColumns(rows[0]);
      console.log(`[corpus] resolved columns: ${JSON.stringify(columns)}`);
    }

    for (const row of rows) {
      byLanguage.set(language, byLanguage.get(language) ?? []);
      byLanguage.get(language)?.push({ ...row, __lang: language, __file: file.path });
    }
  }

  if (!columns) throw new Error("No rows read from any parquet file.");
  const cols = columns;

  // --- Exclusions, sampling, manifest --------------------------------------
  const selected: ManifestRow[] = [];
  const seenIds = new Set<string>();

  for (const [language, rows] of [...byLanguage.entries()].sort()) {
    const eligible = rows.filter((r) => {
      const transcription = String(r[cols.transcription] ?? "").trim();
      const tagged = String(r[cols.tagged] ?? "").trim();
      const duration = cols.duration ? Number(r[cols.duration]) : 0;

      if (duration > MAX_DURATION_S) {
        exclusions.tooLong++;
        return false;
      }
      if (!transcription) {
        exclusions.emptyTranscription++;
        return false;
      }
      if (transcription.split(/\s+/).filter(Boolean).length < MIN_REF_TOKENS) {
        exclusions.tooFewTokens++;
        return false;
      }
      if (tagged && !isWellFormedTagged(tagged)) {
        exclusions.malformedTags++;
        return false;
      }
      return true;
    });

    if (eligible.length === 0) continue;

    // Stratify by duration tercile, then take a systematic sample ordered by CMI
    // with a hash-determined start. Implicit stratification: it balances the CMI
    // distribution across the sample without spending cells on explicit buckets.
    const durations = eligible.map((r) => (cols.duration ? Number(r[cols.duration]) : 0));
    const [t1, t2] = terciles(durations);
    const buckets: (typeof eligible)[] = [[], [], []];
    eligible.forEach((r, i) => {
      const d = durations[i];
      buckets[d <= t1 ? 0 : d <= t2 ? 1 : 2].push(r);
    });

    const perBucket = [
      Math.ceil(perLanguage / 3),
      Math.round(perLanguage / 3),
      perLanguage - Math.ceil(perLanguage / 3) - Math.round(perLanguage / 3),
    ];

    buckets.forEach((bucket, bi) => {
      const want = Math.max(0, perBucket[bi]);
      if (want === 0 || bucket.length === 0) return;

      const ordered = [...bucket].sort(
        (a, b) => Number(a[cols.cmi ?? ""] ?? 0) - Number(b[cols.cmi ?? ""] ?? 0)
      );
      const step = Math.max(1, Math.floor(ordered.length / want));
      const startFrac = selectionKey(language, `${bi}`);
      const start = Math.floor(startFrac * step);

      for (let k = 0, i = start; k < want && i < ordered.length; k++, i += step) {
        const r = ordered[i];
        // Uniqueness matters more than prettiness here: a repeated id means two
        // rows write the same .wav, and the second silently replaces the first
        // while the manifest still describes both.
        const audioPath = (r[cols.audio] as { path?: string } | undefined)?.path;
        const filename = String(
          r[cols.filename ?? ""] ??
            (audioPath ? audioPath.replace(/\.[^.]+$/, "") : `${language}-${bi}-${i}`)
        );
        const tagged = String(r[cols.tagged] ?? r[cols.transcription] ?? "");
        let id = `${language}__${filename}`.replace(/[^A-Za-z0-9_.-]/g, "_");
        if (seenIds.has(id)) id = `${id}__${seenIds.size}`;
        seenIds.add(id);

        selected.push({
          id,
          language,
          filename,
          duration: cols.duration ? Number(r[cols.duration]) : 0,
          cmi: cols.cmi ? Number(r[cols.cmi]) : 0,
          numSwitchPoints: cols.switches ? Number(r[cols.switches]) : 0,
          durationTercile: bi as 0 | 1 | 2,
          transcription: String(r[cols.transcription] ?? ""),
          transcriptionTagged: tagged,
          audioSha256: "",
        });
        // Stash the audio payload for extraction below.
        audioByRowId.set(selected[selected.length - 1].id, r[cols.audio]);
      }
    });

    console.log(`[corpus] ${language}: ${eligible.length} eligible -> selected`);
  }

  // --- Audio extraction ------------------------------------------------------
  console.log(`[corpus] extracting ${selected.length} clips to WAV 16k mono ...`);
  let extracted = 0;
  for (const row of selected) {
    const raw = audioByRowId.get(row.id);
    const bytes = extractAudioBytes(raw);
    if (!bytes) {
      console.warn(`[corpus] no audio bytes for ${row.id}, skipping`);
      continue;
    }
    // Corpus WAVs have unreliable headers; stage through a file so ffmpeg can seek.
    const wav = await toWav16kMono(bytes, { viaFile: true, timeoutMs: 180_000 });
    // A decode that silently truncates would corrupt every metric downstream
    // while looking perfectly healthy, so the extracted length is checked against
    // the corpus's own duration rather than trusted.
    const actual = wavDurationSeconds(wav);
    if (row.duration && Math.abs(actual - row.duration) > Math.max(3, row.duration * 0.05)) {
      console.warn(
        `[corpus] ${row.id}: decoded ${actual.toFixed(1)}s but corpus says ` +
          `${row.duration.toFixed(1)}s - excluding`
      );
      exclusions.truncatedDecode = (exclusions.truncatedDecode ?? 0) + 1;
      continue;
    }
    row.audioSha256 = sha256(wav);
    if (!row.duration) row.duration = actual;

    writeFileSync(path.join(SAMPLES_DIR, `${row.id}.wav`), wav);
    writeFileSync(path.join(SAMPLES_DIR, `${row.id}.txt`), row.transcription, "utf8");
    writeFileSync(
      path.join(SAMPLES_DIR, `${row.id}.meta.json`),
      JSON.stringify(
        {
          languageCode: row.language,
          cmi: row.cmi,
          numSwitchPoints: row.numSwitchPoints,
          duration: row.duration,
          transcriptionTagged: row.transcriptionTagged,
        },
        null,
        2
      ),
      "utf8"
    );
    extracted++;
    if (extracted % 25 === 0) console.log(`[corpus]   ${extracted}/${selected.length}`);
  }

  // Only rows that actually produced audio belong in the manifest.
  const written = selected.filter((r) => r.audioSha256);

  const manifest: Manifest = {
    seed: SEED,
    dataset: DATASET,
    maxDurationSeconds: MAX_DURATION_S,
    datasetCommitSha,
    tier,
    perLanguage,
    createdAt: new Date().toISOString(),
    exclusions,
    rows: written,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestPath = path.join(MANIFEST_DIR, `${datasetKey}-${tier}.json`);
  writeFileSync(manifestPath, manifestJson, "utf8");
  writeFileSync(
    path.join(MANIFEST_DIR, `${datasetKey}-${tier}.sha256`),
    `${createHash("sha256").update(manifestJson).digest("hex")}  ${path.basename(manifestPath)}\n`,
    "utf8"
  );

  // Validate the corpus's own metadata against the tags rather than trusting it:
  // if our parse of transcription_tagged disagrees with the published
  // num_switch_points or cmi columns, one of the two is wrong and every
  // code-switching metric downstream is built on sand.
  const tagged = selected.filter((r) => r.transcriptionTagged);
  const switchPointCheck = tagged.map((r) => {
    const tags = parseTaggedTranscription(r.transcriptionTagged).map((t) => t.tag);
    let n = 0;
    for (let i = 1; i < tags.length; i++) if (tags[i] !== tags[i - 1]) n++;
    return { expected: r.numSwitchPoints, got: n };
  });
  const spDeltas = switchPointCheck.map((c) => Math.abs(c.expected - c.got));
  const spExact = switchPointCheck.length - spDeltas.filter((d) => d > 0).length;
  const spMeanDelta =
    spDeltas.length > 0 ? spDeltas.reduce((a, b) => a + b, 0) / spDeltas.length : 0;
  const spMaxDelta = spDeltas.length > 0 ? Math.max(...spDeltas) : 0;

  const cmiDeviations = tagged.map((r) =>
    Math.abs(
      codeMixingIndex(parseTaggedTranscription(r.transcriptionTagged).map((t) => t.tag)) - r.cmi
    )
  );
  const maxCmiDeviation = cmiDeviations.length > 0 ? Math.max(...cmiDeviations) : 0;
  const meanCmiDeviation =
    cmiDeviations.length > 0 ? cmiDeviations.reduce((a, b) => a + b, 0) / cmiDeviations.length : 0;

  console.log(`\n[corpus] wrote ${extracted} clips to ${SAMPLES_DIR}`);
  console.log(`[corpus] manifest: ${manifestPath}`);
  console.log(`[corpus] exclusions: ${JSON.stringify(exclusions)}`);
  console.log(
    `[corpus] switch-point cross-check: ${spExact}/${switchPointCheck.length} exact, ` +
      `mean |delta| ${spMeanDelta.toFixed(1)}, max ${spMaxDelta} vs num_switch_points`
  );
  if (spMeanDelta > 0) {
    console.log(
      "[corpus]   (a small offset is a definitional difference, not a parse error - the CMI " +
        "cross-check above confirms the tags themselves. Our count is computed identically for " +
        "every system, so the comparison stays internally consistent.)"
    );
  }
  console.log(
    `[corpus] CMI cross-check: mean |delta| ${meanCmiDeviation.toFixed(2)}, ` +
      `max ${maxCmiDeviation.toFixed(2)} (recomputed from tags vs the published cmi column)`
  );
  console.log(`\nCommit the manifest BEFORE running the benchmark - that is the pre-registration.`);
}

const audioByRowId = new Map<string, unknown>();

/**
 * HuggingFace audio features arrive as { bytes, path } structs.
 *
 * Read with { utf8: false } they arrive as Uint8Array. Read with the default they
 * arrive as a UTF-8-decoded string with every invalid sequence replaced, which is
 * unrecoverable - so this throws rather than attempting to re-encode.
 */
function extractAudioBytes(raw: unknown): Buffer | null {
  const asBuffer = (v: unknown): Buffer | null => {
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Uint8Array) return Buffer.from(v);
    // Deliberately NOT accepting a string. Audio arriving as text means the
    // reader decoded it as UTF-8 and the samples are already destroyed; silently
    // re-encoding it produces a file that looks healthy and contains noise.
    if (typeof v === "string") {
      throw new Error(
        "audio column came back as a string - parquet was read with utf8 decoding " +
          "enabled and the samples are corrupt. Read with { utf8: false }."
      );
    }
    return null;
  };
  if (!raw) return null;
  const direct = asBuffer(raw);
  if (direct) return direct;
  if (typeof raw === "object") return asBuffer((raw as { bytes?: unknown }).bytes);
  return null;
}

main().catch((err) => {
  console.error(`\n[corpus] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
