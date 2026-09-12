import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * Normalise any input audio to 16 kHz mono PCM16 WAV.
 *
 * Two reasons this exists:
 *
 * 1. Correctness on the live path. The extension records WebM/Opus, but the Intron
 *    multipart part is labelled audio/wav - without a transcode the vendor receives
 *    Opus bytes under a WAV content type.
 * 2. Fairness on the benchmark path. Every provider must receive byte-identical
 *    audio, decoded once by one decoder. 16 kHz is AfriSwitch's native rate, so
 *    corpus audio is re-containered without resampling.
 */

const FFMPEG = ffmpegPath as unknown as string;

export interface TranscodeOptions {
  /** Input container hint, e.g. "webm", "ogg". Omit to let ffmpeg probe. */
  inputFormat?: string;
  sampleRate?: number;
  timeoutMs?: number;
}

export async function toWav16kMono(input: Buffer, opts: TranscodeOptions = {}): Promise<Buffer> {
  const { inputFormat, sampleRate = 16_000, timeoutMs = 60_000 } = opts;

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    ...(inputFormat ? ["-f", inputFormat] : []),
    "-i",
    "pipe:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(sampleRate),
    "-acodec",
    "pcm_s16le",
    "-f",
    "wav",
    "pipe:1",
  ];

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg transcode timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    proc.stdout.on("data", (c: Buffer) => out.push(c));
    proc.stderr.on("data", (c: Buffer) => errOut.push(c));
    proc.on("error", fail);

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errOut).toString().trim()}`));
        return;
      }
      const buf = Buffer.concat(out);
      if (buf.length === 0) {
        reject(new Error("ffmpeg produced no output"));
        return;
      }
      resolve(buf);
    });

    // EPIPE here means ffmpeg rejected the input and already exited; the close
    // handler reports the real reason from stderr, so swallow it.
    proc.stdin.on("error", () => {});
    proc.stdin.end(input);
  });
}

/** Duration in seconds of a PCM16 WAV buffer, read from its header. */
export function wavDurationSeconds(wav: Buffer): number {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Not a RIFF/WAV buffer");
  }
  const byteRate = wav.readUInt32LE(28);
  if (byteRate === 0) throw new Error("WAV header reports a zero byte rate");

  // Walk the chunk list rather than assuming a 44-byte header - ffmpeg emits a
  // LIST/INFO chunk before `data` often enough that the naive assumption breaks.
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      // When ffmpeg writes to a pipe it cannot seek back to patch the length, so
      // it leaves a placeholder (0, or 0xFFFFFFFF). Trusting it yields nonsense
      // like 134217.7 seconds for a four-second clip - measure the bytes instead.
      const declared = size;
      const actual = wav.length - (offset + 8);
      const usable =
        declared === 0 || declared === 0xffff_ffff || declared > actual ? actual : declared;
      return usable / byteRate;
    }
    if (size === 0 || size === 0xffff_ffff) break;
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk found in WAV");
}
