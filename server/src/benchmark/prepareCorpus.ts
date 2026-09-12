import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { downloadFile, listFiles } from "@huggingface/hub";
import { parquetReadObjects } from "hyparquet";
import { toWav16kMono, wavDurationSeconds } from "../audio/transcode";
import { config } from "../config";
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

const DATASET = "intronhealth/AfriSwitch";
const SEED = "aalto-afriswitch-v1";

const ROOT = path.resolve(__dirname, "../../..");
const SAMPLES_DIR = path.join(ROOT, "benchmark/audio-samples");
const MANIFEST_DIR = path.join(ROOT, "benchmark/manifest");
const PARQUET_CACHE = path.join(ROOT, "benchmark/cache/parquet");

/** Equal allocation per language: Afrikaans has ~198 rows, so proportional sampling
 *  would leave it uninterpretable. Equal n gives every language the same precision. */
const TIERS = { smoke: 5, pilot: 25, main: 100, ablation: 10 } as const;
type Tier = keyof typeof TIERS;

/** Intron's sync endpoint caps at 120s. Exclude rather than truncate for one vendor. */
const MAX_DURATION_S = 110;
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
  if (!(tier in TIERS)) {
    throw new Error(`Unknown tier "${tier}". Expected one of: ${Object.keys(TIERS).join(", ")}`);
  }
  const perLanguage = TIERS[tier];

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

  console.log(`[corpus] tier=${tier} (${perLanguage} utterances/language)`);
  console.log(`[corpus] listing files in ${DATASET} ...`);

  const parquetFiles: { path: string }[] = [];
  let datasetCommitSha = "unknown";
  try {
    for await (const f of listFiles({ repo: { type: "dataset", name: DATASET }, credentials })) {
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
  };
  const byLanguage = new Map<string, (Row & { __lang: string; __file: string })[]>();
  let columns: ReturnType<typeof resolveColumns> | undefined;

  for (const file of chosen) {
    // Config name is the directory segment, e.g. "data/yo/test-00000-of-00001.parquet".
    const segments = file.path.split("/");
    const language = segments.length > 1 ? segments[segments.length - 2] : "unknown";

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
        const filename = String(r[cols.filename ?? ""] ?? `${language}-${i}`);
        const tagged = String(r[cols.tagged] ?? r[cols.transcription] ?? "");
        selected.push({
          id: `${language}__${filename}`.replace(/[^A-Za-z0-9_.-]/g, "_"),
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
    const wav = await toWav16kMono(bytes);
    row.audioSha256 = sha256(wav);
    if (!row.duration) row.duration = wavDurationSeconds(wav);

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

  const manifest: Manifest = {
    seed: SEED,
    dataset: DATASET,
    datasetCommitSha,
    tier,
    perLanguage,
    createdAt: new Date().toISOString(),
    exclusions,
    rows: selected,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestPath = path.join(MANIFEST_DIR, `afriswitch-sample-${tier}.json`);
  writeFileSync(manifestPath, manifestJson, "utf8");
  writeFileSync(
    path.join(MANIFEST_DIR, `afriswitch-sample-${tier}.sha256`),
    `${createHash("sha256").update(manifestJson).digest("hex")}  ${path.basename(manifestPath)}\n`,
    "utf8"
  );

  const switchPointCheck = selected
    .filter((r) => r.transcriptionTagged)
    .map((r) => {
      const tags = parseTaggedTranscription(r.transcriptionTagged).map((t) => t.tag);
      let n = 0;
      for (let i = 1; i < tags.length; i++) if (tags[i] !== tags[i - 1]) n++;
      return { expected: r.numSwitchPoints, got: n };
    });
  const mismatches = switchPointCheck.filter((c) => c.expected !== c.got).length;

  console.log(`\n[corpus] wrote ${extracted} clips to ${SAMPLES_DIR}`);
  console.log(`[corpus] manifest: ${manifestPath}`);
  console.log(`[corpus] exclusions: ${JSON.stringify(exclusions)}`);
  console.log(
    `[corpus] switch-point cross-check against corpus metadata: ` +
      `${switchPointCheck.length - mismatches}/${switchPointCheck.length} agree` +
      (mismatches > 0 ? `  <-- investigate the tag parser before trusting the CS metrics` : "")
  );
  console.log(`\nCommit the manifest BEFORE running the benchmark - that is the pre-registration.`);
}

const audioByRowId = new Map<string, unknown>();

/** HuggingFace audio features arrive as { bytes, path } structs. */
function extractAudioBytes(raw: unknown): Buffer | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === "object") {
    const b = (raw as { bytes?: unknown }).bytes;
    if (Buffer.isBuffer(b)) return b;
    if (b instanceof Uint8Array) return Buffer.from(b);
  }
  return null;
}

main().catch((err) => {
  console.error(`\n[corpus] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
