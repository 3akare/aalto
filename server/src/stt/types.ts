export interface TranscriptionResult {
  provider: string;
  transcript: string;
  languageCode?: string;
  latencyMs: number;
  /**
   * Exact model/version string the vendor actually ran. Vendors ship silent
   * updates; a benchmark without a version string is unfalsifiable, so this is
   * recorded per call and surfaced in the report's provenance table.
   */
  modelVersion?: string;
  /** Number of retries consumed. Reported per vendor - a vendor that needs retries is less reliable. */
  retryCount?: number;
  httpStatus?: number;
  /** Token usage where the vendor bills by token (Gemini), for observed-spend accounting. */
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
  /** Hash of the request parameters, so cached responses can be invalidated when config changes. */
  configHash?: string;
  raw?: unknown;
}

export interface TranscribeOptions {
  /**
   * Matrix-language hint, e.g. "en", "yo", "sw". The AfriSwitch protocol supplies
   * this to every system; providers map it onto their own parameter.
   */
  languageCode?: string;
  filename?: string;
  /**
   * When false, the provider must NOT be given a language hint (used for the
   * no-hint ablation condition). Defaults to true.
   */
  useLanguageHint?: boolean;
}

export interface SttProvider {
  /** Short machine-readable id used in benchmark reports, e.g. "intron", "assemblyai". */
  id: string;
  /** Human readable name. */
  name: string;
  /** Model identifier pinned for this run, recorded in the provenance table. */
  modelId: string;
  /** ISO-639-1 codes this vendor claims to support, used to build the CORE-7 / EXT-14 split. */
  supportedLanguages: ReadonlySet<string>;
  /**
   * Transcribe a 16 kHz mono PCM16 WAV buffer. Every provider receives
   * byte-identical audio - transcoding happens once, upstream.
   */
  transcribe(audio: Buffer, opts?: TranscribeOptions): Promise<TranscriptionResult>;
}

/** The 14 AfriSwitch languages, each code-switching with English. */
export const AFRISWITCH_LANGUAGES = [
  "af",
  "am",
  "fr",
  "ha",
  "ig",
  "lg",
  "om",
  "pcm",
  "rw",
  "sn",
  "sw",
  "tn",
  "yo",
  "zu",
] as const;

export type AfriswitchLanguage = (typeof AFRISWITCH_LANGUAGES)[number];
