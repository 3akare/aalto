import axios from "axios";
import FormData from "form-data";
import type { SttProvider, TranscribeOptions, TranscriptionResult } from "./types";

/**
 * Intron (Sahara Voice AI) Speech-to-Text - synchronous file upload.
 * Docs: https://docs.voice.intron.io/docs/stt/file-upload-sync
 *
 * Limits that shape the harness: audio <= 120 s, and 30 requests/minute. The rate
 * limit is the critical path for the whole benchmark run, so the runner throttles
 * against it rather than relying on retries.
 */

/** Intron documents code-switching support for 11 pairs; these are the AfriSwitch ones. */
const INTRON_SUPPORTED = new Set([
  "af",
  "am",
  "en",
  "ha",
  "ig",
  "lg",
  "pcm",
  "rw",
  "sw",
  "yo",
  "zu",
  "fr",
  "sn",
  "tn",
  "om",
]);

export class IntronSttProvider implements SttProvider {
  id = "intron";
  name = "Intron Sahara STT";
  readonly modelId: string;
  readonly supportedLanguages = INTRON_SUPPORTED as ReadonlySet<string>;

  constructor(
    private apiKey: string,
    private baseUrl: string = "https://infer.voice.intron.io",
    modelId = "sahara-stt"
  ) {
    this.modelId = modelId;
  }

  async transcribe(audio: Buffer, opts: TranscribeOptions = {}): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("audio_file_name", opts.filename ?? "aalto-clip");
    form.append("audio_file_blob", audio, {
      filename: opts.filename ?? "clip.wav",
      contentType: "audio/wav",
    });

    // The endpoint requires a language code. The AfriSwitch protocol supplies the
    // matrix language to every system, so this is the matched primary condition;
    // the no-hint ablation falls back to English, which is the server-side default.
    const useHint = opts.useLanguageHint !== false;
    form.append("use_language_asr_input", useHint ? (opts.languageCode ?? "en") : "en");

    // Skip LLM post-processing so we measure raw ASR rather than ASR + LLM cleanup.
    // This is the Intron half of the matched raw-ASR condition; the AssemblyAI half
    // is punctuate/format_text=false, and the Gemini half is transcription mode
    // "verbatim". Cited in the benchmark report's fairness table.
    form.append("use_disable_llm_corrections", "TRUE");

    const start = Date.now();
    try {
      const res = await axios.post(`${this.baseUrl}/file/v1/upload/sync`, form, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...form.getHeaders(),
        },
        timeout: 180_000,
      });
      const latencyMs = Date.now() - start;
      const data = res.data?.data;
      return {
        provider: this.id,
        transcript: data?.audio_transcript ?? "",
        languageCode: opts.languageCode,
        latencyMs,
        modelVersion: this.modelId,
        httpStatus: res.status,
        raw: res.data,
      };
      // biome-ignore lint/suspicious/noExplicitAny: axios error shape
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      if (err?.response?.status === 503) {
        const fileId = err.response.data?.data?.file_id;
        throw new Error(
          `Intron STT timed out after ${latencyMs}ms (file_id=${fileId}). Poll /file/v1/status to retrieve the result.`
        );
      }
      throw new Error(
        `Intron STT failed: ${err?.response?.status ?? ""} ${JSON.stringify(err?.response?.data ?? err.message)}`
      );
    }
  }
}
