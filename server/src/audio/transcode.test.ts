import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toWav16kMono, wavDurationSeconds } from "./transcode";

/** A 2-second 440 Hz tone, encoded as MP3 by ffmpeg, used as a non-WAV input. */
async function toneMp3(): Promise<Buffer> {
  const { spawnSync } = await import("node:child_process");
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as string;
  const res = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-f",
      "mp3",
      "pipe:1",
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  if (res.status !== 0) throw new Error(`ffmpeg fixture failed: ${res.stderr}`);
  return res.stdout;
}

describe("transcode", () => {
  it("converts arbitrary input to 16 kHz mono PCM16 WAV", async () => {
    const wav = await toWav16kMono(await toneMp3());
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt16LE(22), 1, "channels should be mono");
    assert.equal(wav.readUInt32LE(24), 16_000, "sample rate should be 16 kHz");
    assert.equal(wav.readUInt16LE(34), 16, "bit depth should be 16");
  });

  it("reports a real duration for pipe-written WAVs", async () => {
    // Regression: ffmpeg cannot seek back to patch the data-chunk length when
    // writing to a pipe, so it leaves a placeholder. Trusting the declared size
    // reported a 6-second clip as 134217.7 seconds.
    const wav = await toWav16kMono(await toneMp3());
    const d = wavDurationSeconds(wav);
    assert.ok(d > 1.8 && d < 2.2, `expected ~2s, got ${d}`);
  });

  it("rejects a non-WAV buffer rather than returning nonsense", () => {
    assert.throws(() => wavDurationSeconds(Buffer.alloc(100)), /RIFF/);
  });

  it("surfaces ffmpeg's error when the input is not audio", async () => {
    await assert.rejects(() => toWav16kMono(Buffer.from("not audio at all")), /ffmpeg/i);
  });
});
