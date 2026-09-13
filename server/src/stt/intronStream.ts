import WebSocket from "ws";
import type { SttProvider, TranscribeOptions, TranscriptionResult } from "./types";

export interface IntronStreamOptions {
  apiKey: string;
  languageCode: string; // required by the Intron streaming API
  sampleRate?: number; // default 16000
  /** Hard ceiling on the whole session, so a vendor stall cannot hang the caller. */
  sessionTimeoutMs?: number;
  onPartial?: (transcript: string) => void;
  onError?: (message: string) => void;
}

export interface IntronStreamHandle {
  /**
   * False once the session has ended, for any reason.
   *
   * Sahara will accept a session for a cold language and then drop it a couple of
   * seconds later with no status, so "the open succeeded" is not the same as "the
   * model is loaded". Callers check this after a short grace period.
   */
  isAlive(): boolean;
  sendChunk(pcm16LEChunk: Buffer): void;
  commit(): Promise<string>; // resolves with the final committed transcript
  close(): void;
}

/**
 * Real-time streaming STT over Intron's WebSocket API.
 * Docs: https://docs.voice.intron.io/docs/stt/streaming
 *
 * Session limits: max 300s lifetime, max 60s idle gap, chunks between 1KB-32KB,
 * audio must be base64 PCM16 little-endian.
 *
 * This is the lower-latency path for the live agent (vs. intron.ts's sync
 * upload, which is simpler but waits for the whole clip). Wire this in once
 * the sync flow is working end-to-end and you want snappier turn-taking.
 */
export function openIntronStream(opts: IntronStreamOptions): Promise<IntronStreamHandle> {
  const sampleRate = opts.sampleRate ?? 16000;
  const sessionTimeoutMs = opts.sessionTimeoutMs ?? 120_000;
  const url =
    `wss://infer.voice.intron.io/stt/v1/stream` +
    `?sample_rate=${sampleRate}&bit_rate=16&num_channels=1` +
    `&use_language_asr_input=${encodeURIComponent(opts.languageCode)}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${opts.apiKey}` } });

    // The server expects ack_id to be a sequential counter starting at 1. Starting
    // at 0 (or sending byte offsets) gets every chunk answered with
    // CHUNK_ID_MISMATCH_WITH_TOTAL, and the committed transcript comes back
    // duplicated because the server never accepted the stream in order.
    let ackId = 1;
    let opened = false;

    // A terminal outcome can arrive at ANY point - including while chunks are
    // still being sent, before commit() has been called. The earlier version only
    // held callbacks created by commit(), so an early error was dropped on the
    // floor and commit() then waited forever. Recording the outcome instead means
    // a late commit() settles immediately from stored state.
    let outcome: { transcript: string } | { error: Error } | null = null;
    let resolveCommit: ((transcript: string) => void) | null = null;
    let rejectCommit: ((err: Error) => void) | null = null;

    const settle = (result: { transcript: string } | { error: Error }) => {
      if (outcome) return;
      outcome = result;
      clearTimeout(timer);
      if ("error" in result) {
        opts.onError?.(result.error.message);
        rejectCommit?.(result.error);
        if (!opened) reject(result.error);
      } else {
        resolveCommit?.(result.transcript);
      }
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };

    // Without this a vendor-side stall freezes the whole HTTP request behind it.
    const timer = setTimeout(
      () => settle({ error: new Error(`Intron stream timed out after ${sessionTimeoutMs}ms`) }),
      sessionTimeoutMs
    );

    ws.on("message", (raw) => {
      // biome-ignore lint/suspicious/noExplicitAny: protocol messages are dynamically shaped
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.message_type) {
        case "SESSION_CREATED":
          opened = true;
          resolve({
            isAlive: () => outcome === null && ws.readyState === WebSocket.OPEN,
            sendChunk: (chunk: Buffer) => {
              if (outcome || ws.readyState !== WebSocket.OPEN) return;
              ws.send(
                JSON.stringify({
                  message_type: "INPUT_AUDIO_CHUNK",
                  audio_base_64: chunk.toString("base64"),
                  ack_id: ackId++,
                })
              );
            },
            commit: () =>
              new Promise<string>((res, rej) => {
                if (outcome) {
                  if ("error" in outcome) rej(outcome.error);
                  else res(outcome.transcript);
                  return;
                }
                resolveCommit = res;
                rejectCommit = rej;
                ws.send(JSON.stringify({ message_type: "COMMIT" }));
              }),
            close: () => {
              clearTimeout(timer);
              if (ws.readyState === WebSocket.OPEN) ws.close();
            },
          });
          break;

        case "PARTIAL_TRANSCRIPT":
          opts.onPartial?.(msg.transcript);
          break;

        case "COMMITTED_TRANSCRIPT":
          settle({ transcript: msg.transcript_text ?? "" });
          break;

        // Not terminal on its own, but it means the stream is being ignored - a
        // silent mis-sequence is exactly what produced duplicated transcripts.
        case "CHUNK_ID_MISMATCH_WITH_TOTAL":
          opts.onError?.(
            `chunk ${msg.chunk_id_input} rejected, server expected ${msg.chunk_id_expected}`
          );
          break;

        case "ERROR":
        case "INPUT_ERROR":
        case "AUTHENTICATION_ERROR":
        case "RESOURCE_EXHAUSTED":
        case "QUOTA_EXCEEDED":
        case "SESSION_TIME_LIMIT_EXCEEDED":
        case "INSUFFICIENT_AUDIO_ACTIVITY":
          settle({ error: new Error(msg.message ?? msg.message_type) });
          break;
      }
    });

    ws.on("error", (err) => settle({ error: err }));

    // A close before any transcript would otherwise leave commit() pending.
    ws.on("close", (code, reasonBuf) => {
      const reason = reasonBuf?.toString() || `code ${code}`;
      settle({ error: new Error(`Intron stream closed before committing (${reason})`) });
    });
  });
}

/**
 * Streaming Intron STT behind the standard SttProvider interface.
 *
 * Why this exists rather than the sync client: on this account the sync endpoint
 * (`/file/v1/upload/sync`) rejects anything longer than ~5 seconds with
 * "insufficient balance to process the file", even though the streaming session
 * reports a healthy `credit_balance`. The message is misleading - the balance is
 * fine and streaming handles the same audio. AfriSwitch utterances average ~12s
 * and real spoken commands routinely exceed 5s, so streaming is the only viable
 * path for both the benchmark and the live agent.
 */
export class IntronStreamSttProvider implements SttProvider {
  id = "intron";
  name = "Intron Sahara STT (streaming)";
  readonly modelId: string;
  readonly supportedLanguages: ReadonlySet<string>;

  constructor(
    private apiKey: string,
    supportedLanguages: ReadonlySet<string>,
    modelId = "sahara-stt-stream",
    /** Multiple of realtime to push audio at. 1 = realtime; higher is faster but
     *  risks the server's endpointer mis-segmenting. 4x measured clean. */
    private speedup = 4
  ) {
    this.modelId = modelId;
    this.supportedLanguages = supportedLanguages;
  }

  async transcribe(audio: Buffer, opts: TranscribeOptions = {}): Promise<TranscriptionResult> {
    const pcm = pcmFromWav(audio);
    const useHint = opts.useLanguageHint !== false;
    const start = Date.now();

    // 16KB is 0.5s of 16 kHz PCM16, comfortably inside the 1-32KB chunk window.
    const CHUNK = 16 * 1024;
    const paceMs = 500 / this.speedup;
    const sendMs = Math.ceil(pcm.length / CHUNK) * paceMs;

    // Scale the ceiling with the clip: a fixed timeout that suits a 6-second
    // command will abandon a 6-minute recording mid-decode. Sending time plus a
    // flat allowance for the server to finish committing.
    const stream = await openIntronStream({
      apiKey: this.apiKey,
      languageCode: useHint ? (opts.languageCode ?? "en") : "en",
      sampleRate: 16000,
      sessionTimeoutMs: Math.max(120_000, sendMs + 240_000),
    });
    for (let i = 0; i < pcm.length; i += CHUNK) {
      stream.sendChunk(pcm.subarray(i, Math.min(i + CHUNK, pcm.length)));
      await new Promise((r) => setTimeout(r, paceMs));
    }

    const transcript = await stream.commit();
    stream.close();

    return {
      provider: this.id,
      transcript: transcript.trim(),
      languageCode: opts.languageCode,
      latencyMs: Date.now() - start,
      modelVersion: this.modelId,
    };
  }
}

/** Extract the raw PCM body from a WAV container, skipping any leading chunks. */
export function pcmFromWav(wav: Buffer): Buffer {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Not a RIFF/WAV buffer");
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const startAt = offset + 8;
      const actual = wav.length - startAt;
      // ffmpeg leaves a placeholder length when writing to a pipe.
      const len = size === 0 || size === 0xffff_ffff || size > actual ? actual : size;
      return wav.subarray(startAt, startAt + len);
    }
    if (size === 0 || size === 0xffff_ffff) break;
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk found in WAV");
}
