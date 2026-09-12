import { writeFileSync } from "node:fs";
import path from "node:path";
import axios from "axios";
import { toWav16kMono, wavDurationSeconds } from "../audio/transcode";
import { config } from "../config";
import { TodoistClient } from "../integrations/todoist";
import { Planner } from "../orchestrator/planner";
import { AssemblyAiSttProvider } from "../stt/assemblyai";
import { GeminiSttProvider } from "../stt/gemini";
import { IntronSttProvider } from "../stt/intron";
import type { SttProvider } from "../stt/types";
import { IntronTtsProvider } from "../tts/intron";

/**
 * Credential and wiring check. Costs a handful of API calls and no dataset.
 *
 * Generates real speech with Intron TTS, then pushes those exact bytes through
 * every STT provider - so it exercises the credentials, the transcode, the
 * request shapes and the model pins before a full benchmark run spends anything.
 */

const PHRASE = "My name is Ada Okafor and I want to register my business today.";
const OUT = path.resolve(__dirname, "../../../benchmark/cache/smoke.wav");

async function main(): Promise<void> {
  const results: { step: string; ok: boolean; detail: string }[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? "  ok " : "  FAIL "} ${step.padEnd(34)} ${detail}`);
  };

  console.log("\nAalto smoke test\n");

  // 1. Intron TTS -----------------------------------------------------------
  let wav: Buffer | null = null;
  try {
    const tts = new IntronTtsProvider(config.intron.apiKey, config.intron.baseUrl);
    const out = await tts.generate({
      text: PHRASE,
      voiceLanguage: "en",
      voiceAccent: "yoruba",
      voiceGender: "female",
    });
    if (!out.audioUrl) throw new Error("TTS returned no audio_path");
    const dl = await axios.get<ArrayBuffer>(out.audioUrl, { responseType: "arraybuffer" });
    wav = await toWav16kMono(Buffer.from(dl.data));
    writeFileSync(OUT, wav);
    record("Intron TTS", true, `${wavDurationSeconds(wav).toFixed(1)}s -> ${OUT}`);
  } catch (err) {
    record("Intron TTS", false, msg(err));
  }

  // 2. Every STT provider on identical bytes --------------------------------
  if (wav) {
    const providers: SttProvider[] = [
      new IntronSttProvider(config.intron.apiKey, config.intron.baseUrl),
      new AssemblyAiSttProvider(config.assemblyai.apiKey),
      new GeminiSttProvider(config.gemini.apiKey, {
        kind: "transcribe",
        model: config.gemini.transcribeModel,
      }),
      new GeminiSttProvider(config.gemini.apiKey, {
        kind: "generalist",
        model: config.gemini.plannerModel,
      }),
    ];

    for (const p of providers) {
      try {
        const r = await p.transcribe(wav, { languageCode: "en", filename: "smoke.wav" });
        record(`STT ${p.id}`, true, `${r.latencyMs}ms  "${r.transcript.slice(0, 60)}"`);
      } catch (err) {
        record(`STT ${p.id}`, false, msg(err));
      }
    }
  }

  // 3. Planner fan-out ------------------------------------------------------
  try {
    const planner = new Planner(config.gemini.apiKey, config.gemini.plannerModel);
    const plan = await planner.plan(
      "Open the CAC portal, search for business name registration, and remind me to file on Friday"
    );
    const names = plan.tasks.map((t) => t.tool).join(", ");
    record("Planner (multi-task)", plan.tasks.length >= 2, `${plan.tasks.length} tasks: ${names}`);
  } catch (err) {
    record("Planner (multi-task)", false, msg(err));
  }

  // 4. Todoist --------------------------------------------------------------
  try {
    const todoist = new TodoistClient(config.todoist.apiToken);
    const tasks = await todoist.listTasks();
    record("Todoist", true, `${tasks.length} open task(s)`);
  } catch (err) {
    record("Todoist", false, msg(err));
  }

  // 5. HuggingFace ----------------------------------------------------------
  if (!config.huggingface.token) {
    record("HuggingFace AfriSwitch", false, "HF_TOKEN not set");
  } else {
    try {
      const r = await axios.get(
        "https://huggingface.co/api/datasets/intronhealth/AfriSwitch/tree/main",
        { headers: { Authorization: `Bearer ${config.huggingface.token}` } }
      );
      record("HuggingFace AfriSwitch", true, `access granted, ${r.data.length} entries at root`);
    } catch (err) {
      record("HuggingFace AfriSwitch", false, `${msg(err)} (access may still be pending)`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`Failing: ${failed.map((f) => f.step).join(", ")}`);
    process.exitCode = 1;
  }
}

function msg(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return `HTTP ${err.response?.status ?? "?"} ${JSON.stringify(err.response?.data ?? err.message).slice(0, 180)}`;
  }
  return err instanceof Error ? err.message.slice(0, 180) : String(err);
}

main().catch((err) => {
  console.error(`\nsmoke failed: ${msg(err)}`);
  process.exit(1);
});
