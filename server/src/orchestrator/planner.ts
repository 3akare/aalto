import { GoogleGenAI } from "@google/genai";
import { type AaltoToolName, GEMINI_TOOLS, type RoutedAction } from "./tools";

/**
 * Turns one spoken utterance into a PLAN of tasks.
 *
 * This replaces the previous single-shot router, which forced exactly one tool
 * call and returned the first one - so "open the portal, search for the form, and
 * remind me to file on Friday" could only ever do one of those three things.
 *
 * Gemini's Interactions API returns `interaction.steps[]`, and several
 * `function_call` steps in one response is exactly the fan-out needed: the
 * executor then runs independent tasks concurrently and one summary is spoken back.
 */

const SYSTEM_PROMPT = `You are the planner for Aalto, a voice-controlled browser agent used by people
who speak naturally code-switched language - mixing English with a local language such as Yoruba,
Hausa, Pidgin, Igbo, or Swahili.

The transcript you receive may itself be code-switched, may contain speech-recognition errors, and
may drop articles or use non-standard word order. Interpret intent generously rather than requiring
well-formed English.

An utterance may contain SEVERAL requests. Emit one function call for EACH distinct task the speaker
asked for, in the order they said them. Do not collapse several requests into one, and do not invent
tasks the speaker did not ask for.

If a request is ambiguous or is missing information you would have to guess at, call "clarify"
instead of guessing - especially for anything that fills in a form or changes an existing task,
where a wrong guess is worse than a question.

Above all: DO NOT TAKE THE USER AWAY FROM WHAT THEY ARE DOING. They are working in another tab and
called you without leaving it. Two rules follow from that.

1. If they are ASKING rather than INSTRUCTING - a definition, a fact, a translation, a conversion,
   a calculation, an explanation - use "answer" and say it in one or two spoken sentences. Do not
   send them to a search results page for something you can simply tell them. Reach for
   "search_web" only when the answer genuinely depends on something current, local or specific
   that you cannot state reliably yourself.
2. If they are INSTRUCTING, do the work quietly and report back. Anything that happens away from
   the browser - a Todoist task, for instance - needs no tab at all.

Forms carry one extra rule, because these are civic and government forms and a wrong answer submitted
on someone's behalf is not something they can take back. NEVER call "submit_form" in the same plan as
"fill_form_field". Fill the fields; the user reviews; submitting is a separate, deliberate request.
When they ask what the form says or what they have filled in, use "review_form".`;

export interface PlannedTask extends RoutedAction {
  /** Stable id used to correlate the executor's result and the SSE progress events. */
  id: string;
}

export interface Plan {
  tasks: PlannedTask[];
  /** Gemini interaction id, so a follow-up turn can continue the same timeline. */
  interactionId?: string;
  /** Any prose the model emitted alongside the calls. */
  text?: string;
}

export interface PlannerContext {
  /** Titles/URLs of the user's open tabs, so switch_tab picks a real one. */
  openTabs?: { title: string; url: string }[];
  /** Visible question labels on the active form, so fill_form_field targets a real field. */
  formLabels?: string[];
}

export class Planner {
  private client: GoogleGenAI;

  constructor(
    apiKey: string,
    private model: string
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async plan(transcript: string, context: PlannerContext = {}): Promise<Plan> {
    const contextLines: string[] = [];
    if (context.openTabs?.length) {
      contextLines.push(
        `Open tabs:\n${context.openTabs.map((t, i) => `  ${i + 1}. ${t.title} — ${t.url}`).join("\n")}`
      );
    }
    if (context.formLabels?.length) {
      // Giving the planner the real labels stops it guessing blind and inventing
      // field names the content script then has to fuzzy-match against.
      contextLines.push(
        `Questions on the form currently open:\n${context.formLabels.map((l) => `  - ${l}`).join("\n")}`
      );
    }

    const input = [
      { type: "text" as const, text: SYSTEM_PROMPT },
      ...(contextLines.length ? [{ type: "text" as const, text: contextLines.join("\n\n") }] : []),
      { type: "text" as const, text: `Transcript: ${transcript}` },
    ];

    const interaction = await this.client.interactions.create({
      model: this.model,
      input,
      tools: GEMINI_TOOLS,
      generation_config: { temperature: 0, thinking_level: "low" },
      // biome-ignore lint/suspicious/noExplicitAny: generation_config and the tool shape are not yet in the SDK's typed request union
    } as any);

    // biome-ignore lint/suspicious/noExplicitAny: steps[] is loosely typed in the SDK
    const steps: any[] = (interaction as any)?.steps ?? [];
    const tasks: PlannedTask[] = steps
      .filter((s) => s?.type === "function_call")
      .map((s, i) => ({
        id: `t${i + 1}`,
        tool: s.name as AaltoToolName,
        // Arguments arrive as either a parsed object or a JSON string depending on
        // the step; never string-match on the serialised form.
        input: typeof s.arguments === "string" ? safeParse(s.arguments) : (s.arguments ?? {}),
      }));

    if (tasks.length === 0) {
      return {
        tasks: [
          {
            id: "t1",
            tool: "clarify",
            input: { question: "Sorry, I didn't catch that. Could you say it again?" },
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: id field is untyped
        interactionId: (interaction as any)?.id,
        text: interaction.output_text ?? undefined,
      };
    }

    return {
      tasks: guardPlan(tasks),
      // biome-ignore lint/suspicious/noExplicitAny: id field is untyped
      interactionId: (interaction as any)?.id,
      text: interaction.output_text ?? undefined,
    };
  }
}

/**
 * Drop a submit that arrives alongside field fills.
 *
 * The system prompt forbids this, but a prompt is guidance and this is a civic
 * form: submitting answers the user has not seen is not recoverable, so the rule
 * is enforced here as well. The dropped submit becomes a clarify, so the user is
 * told what happened rather than silently having a request ignored.
 */
export function guardPlan(tasks: PlannedTask[]): PlannedTask[] {
  const fills = tasks.some((t) => t.tool === "fill_form_field");
  const submitAt = tasks.findIndex((t) => t.tool === "submit_form");
  if (!fills || submitAt === -1) return tasks;

  return [
    ...tasks.filter((t) => t.tool !== "submit_form"),
    {
      id: tasks[submitAt].id,
      tool: "clarify",
      input: {
        question:
          'I\'ve filled that in but not submitted it — say "read it back" to check the answers, ' +
          'then "submit" when you\'re happy.',
      },
    },
  ];
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
