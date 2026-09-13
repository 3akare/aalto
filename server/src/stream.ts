import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { TodoistClient } from "./integrations/todoist";
import { executePlan } from "./orchestrator/executor";
import type { Planner, PlannerContext } from "./orchestrator/planner";
import { type IntronStreamHandle, openIntronStream } from "./stt/intronStream";

/**
 * Live audio relay: browser -> here -> Sahara, while the user is still speaking.
 *
 * The HTTP path records a whole command, uploads it, and only then begins
 * transcription, so the clock starts when the speaker stops. A six-second command
 * cost six seconds of recording plus six of transcription. Here the two overlap:
 * by the time someone stops talking, Sahara has already heard almost all of it.
 *
 * Protocol, deliberately small:
 *   client -> {type:"start", languageCode, apiKey, context}
 *   client -> binary PCM16 frames, as captured
 *   client -> {type:"commit"} | {type:"abort"}
 *   server -> {type:"open"} | {type:"partial", text} | {type:"plan", ...}
 *             | {type:"empty"} | {type:"error", message}
 *
 * Partials are forwarded as they arrive so the popup can show words appearing
 * rather than a spinner, which changes how long the wait feels even when it is
 * the same wait.
 */

export interface StreamDeps {
  intronApiKey: string;
  planner: Planner;
  todoist: TodoistClient;
  /** Shared secret, when configured. Checked in-band: browsers cannot set WS headers. */
  authKey: string;
}

interface Session {
  handle: IntronStreamHandle | null;
  committed: boolean;
  languageCode: string;
  context: PlannerContext;
}

export function attachStreamEndpoint(server: Server, deps: StreamDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/stream" });

  // Without this a server-level socket error is an unhandled 'error' event,
  // which throws and takes the process with it.
  wss.on("error", (err) => console.error("[stream] server error:", err.message));

  wss.on("connection", (ws) => {
    const session: Session = {
      handle: null,
      committed: false,
      languageCode: "en",
      context: {},
    };

    const send = (payload: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    };
    const fail = (message: string) => {
      send({ type: "error", message });
      ws.close();
    };
    /** Closing an Intron session twice throws; closing it never leaks a metered one. */
    const closeHandle = () => {
      const handle = session.handle;
      session.handle = null;
      try {
        handle?.close();
      } catch {
        // Already gone.
      }
    };

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      // Never hand an async function straight to an emitter: a rejection inside
      // one is an unhandled rejection, and Node exits on those by default. One
      // bad frame would take the whole server down with it.
      handleMessage(data, isBinary).catch((err) => {
        console.error("[stream] handler failed:", err);
        fail(err instanceof Error ? err.message : "stream failed");
      });
    });

    async function handleMessage(data: Buffer, isBinary: boolean): Promise<void> {
      // Audio frames arrive as raw bytes and are the common case, so they are
      // handled before any parsing is attempted.
      if (isBinary) {
        session.handle?.sendChunk(data);
        return;
      }

      let msg: { type?: string; languageCode?: string; apiKey?: string; context?: PlannerContext };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return fail("malformed control frame");
      }

      if (msg.type === "start") {
        if (deps.authKey && msg.apiKey !== deps.authKey) return fail("unauthorised");
        if (session.handle) return fail("already started");

        session.languageCode = msg.languageCode || "en";
        session.context = msg.context ?? {};

        try {
          session.handle = await openIntronStream({
            apiKey: deps.intronApiKey,
            languageCode: session.languageCode,
            sampleRate: 16_000,
            // Generous: the session should outlive a long spoken command plus the
            // commit that follows it, and Sahara enforces its own 300s cap anyway.
            sessionTimeoutMs: 120_000,
            onPartial: (text) => send({ type: "partial", text }),
            onError: (message) => send({ type: "notice", message }),
          });
          send({ type: "open" });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "could not reach Sahara");
        }
        return;
      }

      if (msg.type === "abort") {
        closeHandle();
        ws.close();
        return;
      }

      if (msg.type === "commit") {
        if (!session.handle || session.committed) return;
        session.committed = true;

        try {
          const transcript = (await session.handle.commit()).trim();
          closeHandle();

          if (!transcript) {
            send({ type: "empty" });
            ws.close();
            return;
          }
          send({ type: "transcript", text: transcript });

          const plan = await deps.planner.plan(transcript, session.context);
          const { serverResults, browserTasks } = await executePlan(plan.tasks, deps.todoist);

          send({ type: "plan", transcript, tasks: plan.tasks, serverResults, browserTasks });
          ws.close();
        } catch (err) {
          closeHandle();
          fail(err instanceof Error ? err.message : "transcription failed");
        }
      }
    }

    // A client that vanishes mid-utterance must not leave a Sahara session open;
    // they are a metered resource with a hard concurrency and time limit.
    ws.on("close", () => {
      closeHandle();
    });
    ws.on("error", (err) => {
      console.error("[stream] socket error:", err.message);
      closeHandle();
    });
  });

  return wss;
}
