import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { openIntronStream } from "./intronStream";

/**
 * Probe: does the Intron STREAMING endpoint carry the same per-request duration
 * cap as the sync endpoint?
 *
 * The sync endpoint rejects anything over ~5 seconds on this account with
 * "insufficient balance to process the file". The streaming endpoint documents a
 * 300s session lifetime instead, so if the cap is a property of the sync route
 * rather than the account, streaming is the way through - for the live agent and
 * for the benchmark alike.
 */

const CLIP = path.resolve(__dirname, "../../../benchmark/cache/smoke.wav");

/** Strip the RIFF header so we send raw PCM16 frames, which is what the API wants. */
function pcmBody(wav: Buffer): Buffer {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      const declared = size;
      const actual = wav.length - start;
      const len = declared === 0 || declared > actual ? actual : declared;
      return wav.subarray(start, start + len);
    }
    if (size === 0) break;
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

async function main(): Promise<void> {
  const wav = readFileSync(CLIP);
  const pcm = pcmBody(wav);
  const seconds = pcm.length / (16000 * 2);
  console.log(`\nStreaming probe: ${seconds.toFixed(1)}s of PCM16 @16kHz (${pcm.length} bytes)`);
  console.log("(the sync endpoint rejects this exact clip)\n");

  const stream = await openIntronStream({
    apiKey: config.intron.apiKey,
    languageCode: "en",
    sampleRate: 16000,
    onPartial: (t) => console.log(`  partial: ${t}`),
    onError: (m) => console.error(`  error:   ${m}`),
  });
  console.log("  session created");

  // Chunks must be 1KB-32KB. 16KB is 0.5s of 16kHz PCM16.
  const CHUNK = 16 * 1024;
  const paceMs = Number(process.argv[2] ?? 500);
  for (let i = 0; i < pcm.length; i += CHUNK) {
    stream.sendChunk(pcm.subarray(i, Math.min(i + CHUNK, pcm.length)));
    await new Promise((r) => setTimeout(r, paceMs));
  }
  const speedup = 500 / paceMs;
  console.log(
    `  sent ${Math.ceil(pcm.length / CHUNK)} chunks at ${paceMs}ms (${speedup}x realtime), committing ...`
  );

  const transcript = await stream.commit();
  stream.close();

  console.log(`\n  FINAL: "${transcript}"`);
  console.log(
    transcript.trim()
      ? "\n  Streaming works on audio the sync endpoint refuses.\n"
      : "\n  Empty transcript - streaming reachable but produced nothing.\n"
  );
}

main().catch((err) => {
  console.error(`\nstream probe failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
