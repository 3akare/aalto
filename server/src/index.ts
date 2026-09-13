import cors from "cors";
import express from "express";
import multer from "multer";
import { toWav16kMono } from "./audio/transcode";
import { assertServerConfig, config } from "./config";
import { TodoistClient } from "./integrations/todoist";
import { executePlan, type TaskResult } from "./orchestrator/executor";
import { Planner } from "./orchestrator/planner";
import { Summariser } from "./orchestrator/summariser";
import { attachStreamEndpoint } from "./stream";
import { INTRON_SUPPORTED } from "./stt/intron";
import { IntronStreamSttProvider } from "./stt/intronStream";
import { IntronTtsProvider } from "./tts/intron";

assertServerConfig();

const app = express();

// Wide-open CORS let anyone who could reach the port spend the API credits and
// write to the user's Todoist. Restrict to configured origins when present.
app.use(
  cors(
    config.auth.allowedOrigins.length > 0
      ? { origin: config.auth.allowedOrigins }
      : { origin: true }
  )
);
app.use(express.json({ limit: "1mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Streaming, not sync: the sync endpoint caps at ~5s and spoken commands run longer.
const stt = new IntronStreamSttProvider(config.intron.apiKey, INTRON_SUPPORTED);
const tts = new IntronTtsProvider(config.intron.apiKey, config.intron.baseUrl);
const planner = new Planner(config.gemini.apiKey, config.gemini.plannerModel);
const summariser = new Summariser(config.gemini.apiKey, config.gemini.plannerModel);
const todoist = new TodoistClient(config.todoist.apiToken);

/** Shared-secret gate. No-ops when AALTO_API_KEY is unset (startup already warned). */
function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!config.auth.apiKey || req.get("x-aalto-key") === config.auth.apiKey) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorised" });
}

/** Intron TTS caps at 4096 characters; a spoken summary is never near that, but clamp anyway. */
async function speak(text: string): Promise<string | undefined> {
  const out = await tts.generate({
    text: text.slice(0, 4000),
    voiceAccent: "yoruba",
    voiceGender: "female",
    voiceLanguage: "en",
  });
  return out.audioUrl;
}

/**
 * Transcribe, plan, and run everything the server can run.
 *
 * Returns the browser-side tasks for the extension to execute. The extension
 * posts their results back to /api/complete, which produces the spoken summary -
 * so the summary describes what actually happened rather than what was dispatched.
 */
app.post("/api/voice-command", requireApiKey, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "missing 'audio' file field" });
      return;
    }
    const languageCode = (req.body.languageCode as string) || undefined;

    // The extension records WebM/Opus; every provider gets 16 kHz mono PCM16 WAV.
    const wav = await toWav16kMono(req.file.buffer);
    const transcription = await stt.transcribe(wav, {
      languageCode,
      filename: req.file.originalname,
    });

    if (!transcription.transcript.trim()) {
      res.json({
        transcript: "",
        tasks: [],
        serverResults: [],
        browserTasks: [],
        summary: "I didn't hear anything. Try again?",
      });
      return;
    }

    const context = safeParseContext(req.body.context);
    const plan = await planner.plan(transcription.transcript, context);
    const { serverResults, browserTasks } = await executePlan(plan.tasks, todoist);

    res.json({
      transcript: transcription.transcript,
      sttLatencyMs: transcription.latencyMs,
      tasks: plan.tasks,
      serverResults,
      browserTasks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    console.error("[voice-command]", message);
    res.status(500).json({ error: message });
  }
});

/**
 * Collect every task's outcome and speak one summary.
 *
 * `muted` skips the TTS call entirely rather than generating audio and dropping
 * it - that saves both quota and latency, and the written summary still returns.
 */
app.post("/api/complete", requireApiKey, async (req, res) => {
  try {
    const results = (req.body.results ?? []) as TaskResult[];

    // Text only. Generating speech first meant the user stared at a spinner for
    // the two seconds TTS takes, even though the answer was already known. The
    // caller renders this immediately and asks for audio separately.
    const summary = await summariser.summarise(results);
    res.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    console.error("[complete]", message);
    res.status(500).json({ error: message });
  }
});

/** Speech for an already-delivered summary, fetched in parallel with rendering it. */
app.post("/api/speak", requireApiKey, async (req, res) => {
  try {
    const text = String(req.body.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "missing 'text'" });
      return;
    }
    res.json({ audioUrl: await speak(text) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    console.error("[speak]", message);
    res.status(502).json({ error: message });
  }
});

app.get("/api/todoist/tasks", requireApiKey, async (_req, res) => {
  try {
    res.json(await todoist.listTasks());
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    console.error("[todoist]", message);
    res.status(502).json({ error: message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function safeParseContext(raw: unknown): {
  openTabs?: { title: string; url: string }[];
  formLabels?: string[];
} {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const server = app.listen(config.port, () => {
  console.log(`Aalto server listening on http://localhost:${config.port}`);
  console.log(`  live audio stream at ws://localhost:${config.port}/api/stream`);
});

// The live path. The HTTP /api/voice-command route stays as the fallback for
// clients that cannot hold a socket open, and as a way to bisect a failure
// between the transport and everything behind it.
attachStreamEndpoint(server, {
  intronApiKey: config.intron.apiKey,
  planner,
  todoist,
  authKey: config.auth.apiKey,
});
