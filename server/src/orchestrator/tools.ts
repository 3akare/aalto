// Tool schema used by the orchestration LLM to translate a transcript into a
// single structured action. Keep this in sync with extension/background.js,
// which is what actually executes browser-side actions.

export const AALTO_TOOLS = [
  {
    name: "search_web",
    description: "Open a new tab and perform a Google search for the given query.",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"],
    },
  },
  {
    name: "open_url",
    description: "Open a specific URL in a new tab.",
    input_schema: {
      type: "object" as const,
      properties: { url: { type: "string", description: "Fully qualified URL to open" } },
      required: ["url"],
    },
  },
  {
    name: "switch_tab",
    description:
      "Switch to a browser tab matching a description (title/domain) or by relative position.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "e.g. 'the gmail tab', 'next tab', 'previous tab'",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "fill_form_field",
    description:
      "Fill a single field on the currently open Google Form (or a form on the active page) with a value, matched by the field's visible label.",
    input_schema: {
      type: "object" as const,
      properties: {
        fieldLabel: { type: "string", description: "The visible label/question text of the field" },
        value: { type: "string", description: "The value to enter" },
      },
      required: ["fieldLabel", "value"],
    },
  },
  {
    name: "review_form",
    description:
      "Read back every question on the open form together with what is currently entered against " +
      "it, so the user can check their answers before submitting. Use this whenever they ask what " +
      "the form says, what they have filled in, or to check something over.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "submit_form",
    description:
      "Submit the currently open form. Only ever use this when the user explicitly asks to " +
      "submit. Never add it to a plan that also fills fields in - they have not seen what was " +
      "entered yet.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "todoist_add",
    description: "Add a new task to Todoist.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "The task text" },
        dueString: {
          type: "string",
          description: "Natural-language due date, e.g. 'Friday', 'tomorrow 5pm'",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "todoist_complete",
    description: "Mark a Todoist task as complete, matched by a spoken description.",
    input_schema: {
      type: "object" as const,
      properties: { description: { type: "string" } },
      required: ["description"],
    },
  },
  {
    name: "todoist_update",
    description: "Update a Todoist task's text and/or due date, matched by a spoken description.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "How to find the existing task" },
        newContent: { type: "string", description: "New task text, if changing it" },
        newDueString: {
          type: "string",
          description: "New natural-language due date, if changing it",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "answer",
    description:
      "Answer a question directly, in place, without opening or changing anything. Use this for " +
      "definitions, factual questions, translations, conversions, arithmetic, explanations - " +
      "anything the user simply wants to KNOW. This is the preferred tool whenever the user is " +
      "asking rather than instructing: it keeps them where they are instead of sending them to a " +
      "search results page. Only fall back to search_web when the answer depends on something " +
      "current or local that you cannot state reliably.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description:
            "The answer, in one or two short sentences of plain language. It will be read aloud, " +
            "so write it to be spoken: no markdown, no lists, no citations, no preamble.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "clarify",
    description:
      "Use this when the transcript is too ambiguous or incomplete to safely map to another tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "A short clarifying question to speak back to the user",
        },
      },
      required: ["question"],
    },
  },
] as const;

export type AaltoToolName = (typeof AALTO_TOOLS)[number]["name"];

export interface RoutedAction {
  tool: AaltoToolName;
  input: Record<string, unknown>;
}

/**
 * The same tools in Gemini's Interactions API shape.
 *
 * Gemini takes a flat `{type, name, description, parameters}` per function, where
 * the Anthropic shape nests the schema under `input_schema`. Keeping one source of
 * truth and converting here avoids the two lists drifting apart.
 */
export const GEMINI_TOOLS = AALTO_TOOLS.map((t) => ({
  type: "function" as const,
  name: t.name,
  description: t.description,
  parameters: {
    type: "object",
    properties: ("properties" in t.input_schema ? t.input_schema.properties : {}) as Record<
      string,
      unknown
    >,
    required: ("required" in t.input_schema ? t.input_schema.required : []) as string[],
  },
}));

/** Tools Aalto executes on the server; everything else is executed by the extension. */
export const SERVER_SIDE_TOOLS = new Set<AaltoToolName>([
  "todoist_add",
  "todoist_complete",
  "todoist_update",
  "answer",
  "clarify",
]);

export function isServerSide(tool: AaltoToolName): boolean {
  return SERVER_SIDE_TOOLS.has(tool);
}
