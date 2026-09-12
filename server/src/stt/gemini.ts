import { GoogleGenAI } from "@google/genai";
import type { SttProvider, TranscribeOptions, TranscriptionResult } from "./types";

/**
 * BCP-47 tags for the 14 AfriSwitch languages.
 *
 * Every entry here is a documented mapping decision and is reproduced verbatim in
 * the benchmark report's appendix - an undocumented code mapping is exactly the
 * kind of silent asymmetry that makes a cross-vendor comparison unfair.
 *
 * `pcm` (Nigerian Pidgin), `om` (Oromo) and `tn` (Tswana) are valid ISO-639 codes
 * and therefore well-formed BCP-47, but Google does not list them as supported
 * transcription languages. They are passed through as-is rather than being
 * silently remapped to a neighbouring language, and the resulting behaviour
 * (detected-language fallback) is reported rather than hidden.
 */
export const GEMINI_LANGUAGE_TAGS: Record<string, string> = {
  af: "af-ZA",
  am: "am-ET",
  fr: "fr-FR",
  ha: "ha-NG",
  ig: "ig-NG",
  lg: "lg-UG",
  om: "om-ET",
  pcm: "pcm-NG",
  rw: "rw-RW",
  sn: "sn-ZW",
  sw: "sw-KE",
  tn: "tn-ZA",
  yo: "yo-NG",
  zu: "zu-ZA",
  en: "en-US",
};

/** Languages Google documents as supported for transcription. Drives the coverage table. */
const GEMINI_SUPPORTED = new Set([
  "af",
  "am",
  "en",
  "fr",
  "ha",
  "ig",
  "lg",
  "rw",
  "sn",
  "sw",
  "yo",
  "zu",
]);

/**
 * The generalist model needs a text instruction; the dedicated transcribe model
 * does not. This prompt is published verbatim in the report appendix because
 * prompt choice is a confound, and it is deliberately minimal: no few-shot
 * examples, no orthography guidance, nothing that would bias toward the
 * reference transcription conventions.
 */
export const GEMINI_FLASH_PROMPT =
  "Transcribe this audio verbatim. Output only the transcription, with no commentary, " +
  "no translation, and no explanation. Preserve the speaker's original languages exactly " +
  "as spoken, including any switching between languages mid-sentence.";

export interface GeminiSttOptions {
  /** "transcribe" pins the dedicated ASR model; "generalist" uses the multimodal LLM. */
  kind: "transcribe" | "generalist";
  model: string;
  id?: string;
  name?: string;
}

export class GeminiSttProvider implements SttProvider {
  readonly id: string;
  readonly name: string;
  readonly modelId: string;
  readonly supportedLanguages = GEMINI_SUPPORTED as ReadonlySet<string>;

  private client: GoogleGenAI;
  private kind: GeminiSttOptions["kind"];

  constructor(apiKey: string, opts: GeminiSttOptions) {
    this.client = new GoogleGenAI({ apiKey });
    this.kind = opts.kind;
    this.modelId = opts.model;
    this.id = opts.id ?? (opts.kind === "transcribe" ? "gemini-transcribe" : "gemini-flash");
    this.name =
      opts.name ??
      (opts.kind === "transcribe"
        ? `Google ${opts.model} (dedicated ASR)`
        : `Google ${opts.model} (generalist multimodal)`);
  }

  async transcribe(audio: Buffer, opts: TranscribeOptions = {}): Promise<TranscriptionResult> {
    const useHint = opts.useLanguageHint !== false;
    const tag = opts.languageCode ? GEMINI_LANGUAGE_TAGS[opts.languageCode] : undefined;

    const audioPart = {
      type: "audio" as const,
      data: audio.toString("base64"),
      mime_type: "audio/wav",
    };

    // `mode: { type: "verbatim" }` disables Smart Dictation & Formatting, which
    // otherwise strips fillers and applies semantic cleanup. This is what makes
    // Gemini comparable with Intron's use_disable_llm_corrections=TRUE and
    // AssemblyAI's format_text=false: all three are measured as raw ASR.
    const transcriptionConfig = {
      language_codes: useHint && tag ? [tag] : [],
      mode: { type: "verbatim" },
    };

    const request =
      this.kind === "transcribe"
        ? {
            model: this.modelId,
            input: [audioPart],
            generation_config: { transcription_config: transcriptionConfig },
          }
        : {
            model: this.modelId,
            input: [{ type: "text" as const, text: GEMINI_FLASH_PROMPT }, audioPart],
            generation_config: {
              temperature: 0,
              thinking_level: "minimal",
            },
          };

    const start = Date.now();
    // biome-ignore lint/suspicious/noExplicitAny: the SDK's request union does not yet model transcription_config; shape is per the published REST reference
    const interaction = await this.client.interactions.create(request as any);
    const latencyMs = Date.now() - start;

    // biome-ignore lint/suspicious/noExplicitAny: usage metadata is not in the typed surface.
    const usage = (interaction as any)?.usage ?? {};

    return {
      provider: this.id,
      transcript: (interaction.output_text ?? "").trim(),
      languageCode: opts.languageCode,
      latencyMs,
      modelVersion: this.modelId,
      tokenUsage: {
        inputTokens: usage.input_tokens ?? usage.prompt_token_count,
        outputTokens: usage.output_tokens ?? usage.candidates_token_count,
      },
      raw: interaction,
    };
  }
}
