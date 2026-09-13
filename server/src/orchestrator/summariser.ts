import { GoogleGenAI } from "@google/genai";
import type { TaskResult } from "./executor";

/**
 * Turns a batch of task results into one short sentence to speak back.
 *
 * Deliberately does not call the model when it isn't needed: a single successful
 * task already has a well-formed detail string, and a round trip to an LLM to
 * restate it would only add latency and a chance to hallucinate.
 */
export class Summariser {
  private client: GoogleGenAI;

  constructor(
    apiKey: string,
    private model: string
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async summarise(results: readonly TaskResult[]): Promise<string> {
    if (results.length === 0) return "I didn't catch anything to do.";

    // A question back to the user is never merged into a summary - it has to be
    // asked verbatim or the user cannot answer it.
    const question = results.find((r) => r.status === "needs_input");
    if (question) return question.detail;

    // An answer is the substance of the reply, not a status report. Summarising
    // "answered: love is ..." into "I answered your question" would throw away the
    // only thing the user actually asked for. Speak it as written, and append a
    // short note about any side tasks that ran alongside it.
    const answers = results.filter((r) => r.status === "answered");
    if (answers.length > 0) {
      const others = results.filter((r) => r.status !== "answered");
      const answerText = answers.map((a) => a.detail).join(" ");
      if (others.length === 0) return answerText;
      return `${answerText} ${fallbackSummary(others)}`;
    }

    if (results.length === 1) {
      const only = results[0];
      return capitalise(only.status === "ok" ? `${only.detail}.` : `Sorry, I ${only.detail}.`);
    }

    const lines = results
      .map((r) => `- ${r.status === "ok" ? "done" : "failed"}: ${r.detail}`)
      .join("\n");

    try {
      const interaction = await this.client.interactions.create({
        model: this.model,
        input: [
          {
            type: "text",
            text:
              "Summarise these completed actions as ONE short sentence to be read aloud to the " +
              "user. Be plain and factual. Mention anything that failed. Do not add greetings, " +
              "offers of further help, or commentary. Output only the sentence.\n\n" +
              lines,
          },
        ],
        generation_config: { temperature: 0, thinking_level: "low" },
        // biome-ignore lint/suspicious/noExplicitAny: generation_config is not in the SDK's typed request union
      } as any);
      const text = (interaction.output_text ?? "").trim();
      if (text) return text;
    } catch {
      // Fall through to the deterministic summary below.
    }

    return fallbackSummary(results);
  }
}

/** Used when the model is unavailable - never leave the user with silence. */
export function fallbackSummary(results: readonly TaskResult[]): string {
  const ok = results.filter((r) => r.status === "ok");
  const bad = results.filter((r) => r.status !== "ok");

  const parts: string[] = [];
  if (ok.length > 0) parts.push(joinClauses(ok.map((r) => r.detail)));
  if (bad.length > 0) parts.push(`but I couldn't ${joinClauses(bad.map((r) => r.detail))}`);
  return capitalise(`${parts.join(", ")}.`);
}

function joinClauses(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
