import WebSocket from "ws";

export interface IntronStreamOptions {
  apiKey: string;
  languageCode: string; // required by the Intron streaming API
  sampleRate?: number; // default 16000
  onPartial?: (transcript: string) => void;
  onError?: (message: string) => void;
}

export interface IntronStreamHandle {
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
  const url =
    `wss://infer.voice.intron.io/stt/v1/stream` +
    `?sample_rate=${sampleRate}&bit_rate=16&num_channels=1` +
    `&use_language_asr_input=${encodeURIComponent(opts.languageCode)}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });

    let ackId = 0;
    let resolveCommit: ((transcript: string) => void) | null = null;
    let rejectCommit: ((err: Error) => void) | null = null;

    ws.on("open", () => {
      // Wait for SESSION_CREATED before resolving so callers know the session is live.
    });

    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.message_type) {
        case "SESSION_CREATED":
          resolve({
            sendChunk: (chunk: Buffer) => {
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
                resolveCommit = res;
                rejectCommit = rej;
                ws.send(JSON.stringify({ message_type: "COMMIT" }));
              }),
            close: () => ws.close(),
          });
          break;

        case "PARTIAL_TRANSCRIPT":
          opts.onPartial?.(msg.transcript);
          break;

        case "COMMITTED_TRANSCRIPT":
          resolveCommit?.(msg.transcript_text ?? "");
          ws.close();
          break;

        case "ERROR":
        case "INPUT_ERROR":
        case "AUTHENTICATION_ERROR":
        case "RESOURCE_EXHAUSTED":
        case "QUOTA_EXCEEDED":
        case "SESSION_TIME_LIMIT_EXCEEDED":
        case "INSUFFICIENT_AUDIO_ACTIVITY":
          opts.onError?.(msg.message ?? msg.message_type);
          rejectCommit?.(new Error(msg.message ?? msg.message_type));
          break;
      }
    });

    ws.on("error", (err) => {
      opts.onError?.(err.message);
      reject(err);
      rejectCommit?.(err);
    });
  });
}
