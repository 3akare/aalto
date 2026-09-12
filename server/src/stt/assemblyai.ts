import axios from "axios";
import type { SttProvider, TranscribeOptions, TranscriptionResult } from "./types";

/**
 * AssemblyAI batch transcription - comparison model, and the shared foundation for
 * the separate AssemblyAI submission.
 *
 * Model pinning matters here: `universal-3-pro` was retired on 2 September 2026 and
 * the request parameter changed from `speech_model` (string) to `speech_models`
 * (array, used as an ordered fallback list). Omitting it entirely means the run
 * silently rides "whatever is latest", which is not reproducible - a benchmark
 * without a pinned version is unfalsifiable.
 */
export const ASSEMBLYAI_MODELS = ["universal-3-5-pro", "universal-2"] as const;

/**
 * The languages AssemblyAI documents as supported, intersected with AfriSwitch's 14.
 *
 * This is 7 of 14. Reporting a 14-language average that includes seven languages
 * this vendor never claimed to support would be a rigged comparison, so the
 * benchmark splits CORE-7 (all vendors claim support) from EXT-14 and excludes
 * unsupported cells from every average and significance test.
 */
const ASSEMBLYAI_SUPPORTED = new Set(["af", "am", "en", "fr", "ha", "sn", "sw", "yo"]);

export class AssemblyAiSttProvider implements SttProvider {
  id = "assemblyai";
  name = "AssemblyAI Universal-3.5 Pro";
  readonly modelId = ASSEMBLYAI_MODELS[0];
  readonly supportedLanguages = ASSEMBLYAI_SUPPORTED as ReadonlySet<string>;

  private baseUrl = "https://api.assemblyai.com/v2";

  constructor(private apiKey: string) {}

  private authHeaders() {
    return { authorization: this.apiKey };
  }

  async transcribe(audio: Buffer, opts: TranscribeOptions = {}): Promise<TranscriptionResult> {
    const start = Date.now();

    const uploadRes = await axios.post(`${this.baseUrl}/upload`, audio, {
      headers: { ...this.authHeaders(), "content-type": "application/octet-stream" },
      maxBodyLength: Number.POSITIVE_INFINITY,
    });
    const uploadUrl = uploadRes.data.upload_url;

    const useHint = opts.useLanguageHint !== false;
    const hintable = opts.languageCode && ASSEMBLYAI_SUPPORTED.has(opts.languageCode);

    const body: Record<string, unknown> = {
      audio_url: uploadUrl,
      speech_models: [...ASSEMBLYAI_MODELS],
      // Raw-ASR condition, matched across vendors: no punctuation restoration, no
      // text formatting, no vocabulary biasing, disfluencies retained. Filler
      // removal is then applied identically to every system by the normaliser.
      punctuate: false,
      format_text: false,
      disfluencies: true,
      word_boost: [],
    };

    // The AfriSwitch protocol supplies the matrix language to every system. Where
    // the vendor does not support that language we fall back to auto-detect rather
    // than sending a code it would reject - and record which path was taken.
    if (useHint && hintable) {
      body.language_code = opts.languageCode;
    } else {
      body.language_detection = true;
    }

    const submitRes = await axios.post(`${this.baseUrl}/transcript`, body, {
      headers: { ...this.authHeaders(), "content-type": "application/json" },
    });
    const transcriptId = submitRes.data.id;

    // 500ms, not 1500ms: a slow poll interval inflates measured latency by up to
    // the interval itself, which would be a pure measurement artefact rather than
    // anything about the vendor.
    const pollIntervalMs = 500;
    const maxWaitMs = 180_000;
    let waited = 0;
    while (waited < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      waited += pollIntervalMs;
      const pollRes = await axios.get(`${this.baseUrl}/transcript/${transcriptId}`, {
        headers: this.authHeaders(),
      });
      if (pollRes.data.status === "completed") {
        return {
          provider: this.id,
          transcript: pollRes.data.text ?? "",
          languageCode: pollRes.data.language_code ?? opts.languageCode,
          latencyMs: Date.now() - start,
          modelVersion: pollRes.data.speech_model ?? this.modelId,
          httpStatus: pollRes.status,
          raw: pollRes.data,
        };
      }
      if (pollRes.data.status === "error") {
        throw new Error(`AssemblyAI transcription failed: ${pollRes.data.error}`);
      }
    }
    throw new Error(`AssemblyAI transcription timed out after ${maxWaitMs}ms`);
  }
}
