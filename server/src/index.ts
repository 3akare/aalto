import cors from "cors";
import express from "express";
import multer from "multer";
import { toWav16kMono } from "./audio/transcode";
import { assertServerConfig, config } from "./config";
import { TodoistClient } from "./integrations/todoist";
import { Planner } from "./orchestrator/planner";
import { isServerSide, type RoutedAction } from "./orchestrator/tools";
import { IntronSttProvider } from "./stt/intron";
import { IntronTtsProvider } from "./tts/intron";

assertServerConfig();

const app = express();

// Wide-open CORS let anyone who could reach the port spend the API credits and
// write to the user's Todoist. Restrict to the extension's own origin when one
// is configured; fall back to permissive only when the allowlist is empty.
app.use(
  cors(
    config.auth.allowedOrigins.length > 0
      ? { origin: config.auth.allowedOrigins }
      : { origin: true }
  )
);
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const stt = new IntronSttProvider(config.intron.apiKey, config.intron.baseUrl);
const tts = new IntronTtsProvider(config.intron.apiKey, config.intron.baseUrl);
const planner = new Planner(config.gemini.apiKey, config.gemini.plannerModel);
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

/**
 * Actions the server resolves itself (Todoist, clarify). Everything else is
 * returned to the extension, which alone has chrome.tabs and page DOM access.
 */
async function resolveServerSideAction(action: RoutedAction): Promise<string | null> {
  switch (action.tool) {
    case "todoist_add": {
      const task = await todoist.addTask(action.input.content as string, {
        dueString: action.input.dueString as string | undefined,
      });
      return `Added "${task.content}" to your Todoist${task.due ? `, due ${task.due}` : ""}.`;
    }
    case "todoist_complete": {
      const task = await todoist.completeTaskByDescription(action.input.description as string);
      return task
        ? `Marked "${task.content}" as done.`
        : `I couldn't find a task matching "${action.input.description}".`;
    }
    case "todoist_update": {
      const task = await todoist.updateTaskByDescription(action.input.description as string, {
        content: action.input.newContent as string | undefined,
        dueString: action.input.newDueString as string | undefined,
      });
      return task
        ? `Updated the task to "${task.content}"${task.due ? `, due ${task.due}` : ""}.`
        : `I couldn't find a task matching "${action.input.description}".`;
    }
    case "clarify":
      return action.input.question as string;
    default:
      return null;
  }
}

app.post("/api/voice-command", requireApiKey, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "missing 'audio' file field" });
      return;
    }
    const languageCode = (req.body.languageCode as string) || undefined;
    // The extension records WebM/Opus; every STT provider is given 16 kHz mono
    // PCM16 WAV, transcoded once here so the wire format matches the declared type.
    const wav = await toWav16kMono(req.file.buffer);

    const transcription = await stt.transcribe(wav, {
      languageCode,
      filename: req.file.originalname,
    });

    const plan = await planner.plan(transcription.transcript);

    // TODO(day 2): fan the plan out through the executor and stream progress over
    // SSE. For now the first task is resolved so the end-to-end path stays testable.
    const [first] = plan.tasks;
    const confirmationText = isServerSide(first.tool) ? await resolveServerSideAction(first) : null;

    let audioUrl: string | undefined;
    const muted = req.body.muted === "true";
    if (confirmationText && !muted) {
      const ttsResult = await tts.generate({
        text: confirmationText,
        voiceAccent: "nigerian",
        voiceGender: "female",
        voiceLanguage: "en",
      });
      audioUrl = ttsResult.audioUrl;
    }

    res.json({
      transcript: transcription.transcript,
      tasks: plan.tasks,
      action: first,
      confirmationText,
      audioUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    console.error(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/todoist/tasks", requireApiKey, async (_req, res) => {
  try {
    res.json(await todoist.listTasks());
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    console.error(err);
    res.status(502).json({ error: message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`Aalto server listening on http://localhost:${config.port}`);
});
