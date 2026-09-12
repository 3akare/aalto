import axios from "axios";

export interface TtsOptions {
  text: string;
  voiceLanguage?: string; // e.g. "en", "ha" (default "en")
  voiceAccent: string; // required - see supported-languages-and-accents
  voiceGender: "male" | "female"; // required
  outputAudioFormat?: "wav" | "opus";
}

export interface TtsResult {
  audioUrl: string;
  audioDurationSeconds: number;
}

/**
 * Intron (Sahara Voice AI) Text-to-Speech - synchronous generate endpoint.
 * Docs: https://docs.voice.intron.io/docs/tts/tts-generate
 * Max 4096 characters per request.
 */
export class IntronTtsProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string = "https://infer.voice.intron.io"
  ) {}

  async generate(opts: TtsOptions): Promise<TtsResult> {
    if (opts.text.length > 4096) {
      throw new Error("Intron TTS: text exceeds the 4096 character limit");
    }
    const res = await axios.post(
      `${this.baseUrl}/tts/v1/generate`,
      {
        text: opts.text,
        voice_language: opts.voiceLanguage ?? "en",
        voice_accent: opts.voiceAccent,
        voice_gender: opts.voiceGender,
        output_audio_format: opts.outputAudioFormat ?? "wav",
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 130_000,
      }
    );
    const data = res.data?.data;
    return {
      audioUrl: data?.audio_path,
      audioDurationSeconds: data?.audio_duration_in_seconds,
    };
  }
}
