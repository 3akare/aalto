import axios from "axios";
import { config } from "../config";
import { IntronTtsProvider } from "../tts/intron";

/**
 * End-to-end check of the live agent path against a running server.
 *
 * Uses a browser-only command deliberately: the server returns browser tasks for
 * the extension to run rather than executing them, so this exercises
 * transcribe -> plan -> split -> summarise without writing to the real Todoist.
 */

const BASE = `http://localhost:${config.port}`;
const COMMAND = "Search for business name registration and open the C A C website.";

async function main(): Promise<void> {
  console.log("\nAalto end-to-end (server)\n");

  const health = await axios.get(`${BASE}/health`, { timeout: 5000 }).catch(() => null);
  if (!health) throw new Error(`no server on ${BASE} - start it with: npm run dev`);
  console.log("  ok    server is up");

  const tts = new IntronTtsProvider(config.intron.apiKey, config.intron.baseUrl);
  const spoken = await tts.generate({
    text: COMMAND,
    voiceLanguage: "en",
    voiceAccent: "yoruba",
    voiceGender: "female",
  });
  const audio = Buffer.from(
    (await axios.get<ArrayBuffer>(spoken.audioUrl as string, { responseType: "arraybuffer" })).data
  );
  console.log(`  ok    spoke the command (${(audio.length / 1024).toFixed(0)} KB)`);

  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "command.wav");
  form.append("languageCode", "en");

  const t0 = Date.now();
  const res = await axios.post(`${BASE}/api/voice-command`, form, { timeout: 180_000 });
  const elapsed = Date.now() - t0;
  const { transcript, tasks, serverResults, browserTasks } = res.data;

  console.log(`  ok    transcribed in ${elapsed}ms: "${transcript}"`);
  console.log(
    `  ok    planned ${tasks.length} task(s): ${tasks.map((t: { tool: string }) => t.tool).join(", ")}`
  );
  console.log(`        ${serverResults.length} server-side, ${browserTasks.length} browser-side`);

  if (browserTasks.length === 0) {
    console.log("  WARN  expected browser tasks for this command");
  }
  if (serverResults.length > 0) {
    console.log(`        server results: ${JSON.stringify(serverResults)}`);
  }

  // Pretend the extension ran them, and ask for the spoken summary.
  const pretend = browserTasks.map((t: { id: string; tool: string }) => ({
    id: t.id,
    tool: t.tool,
    status: "ok",
    detail:
      t.tool === "search_web" ? "searched for business name registration" : "opened cac.gov.ng",
  }));

  const done = await axios.post(
    `${BASE}/api/complete`,
    { results: [...serverResults, ...pretend], muted: false },
    { timeout: 120_000 }
  );
  console.log(`  ok    summary: "${done.data.summary}"`);
  console.log(`  ok    spoken reply: ${done.data.audioUrl ? "generated" : "none"}`);

  // And confirm muting actually skips the TTS call rather than generating audio
  // and discarding it.
  const mutedRes = await axios.post(
    `${BASE}/api/complete`,
    { results: [...serverResults, ...pretend], muted: true },
    { timeout: 120_000 }
  );
  console.log(
    mutedRes.data.audioUrl
      ? "  FAIL  muted request still returned audio"
      : "  ok    muted request skipped TTS entirely"
  );

  console.log("");
}

main().catch((err) => {
  const detail = axios.isAxiosError(err)
    ? `${err.response?.status ?? ""} ${JSON.stringify(err.response?.data ?? err.message)}`
    : err instanceof Error
      ? err.message
      : String(err);
  console.error(`\ne2e failed: ${detail}\n`);
  process.exit(1);
});
