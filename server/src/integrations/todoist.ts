import { TodoistApi } from "@doist/todoist-sdk";

export interface TodoistTask {
  id: string;
  content: string;
  isCompleted: boolean;
  due?: string | null;
}

export interface TaskMatch {
  task: TodoistTask;
  /** Other tasks that scored close enough to be plausible - triggers a clarify. */
  alternatives: TodoistTask[];
}

/**
 * Todoist client on API v1.
 *
 * The previous version hand-rolled REST v2, which now returns HTTP 410
 * ("This endpoint is deprecated") - every Todoist command failed. This uses the
 * official SDK against v1.
 */
export class TodoistClient {
  private api: TodoistApi;

  constructor(apiToken: string) {
    this.api = new TodoistApi(apiToken);
  }

  // biome-ignore lint/suspicious/noExplicitAny: SDK task shape varies by endpoint
  private static map(t: any): TodoistTask {
    return {
      id: String(t.id),
      content: t.content,
      isCompleted: Boolean(t.checked ?? t.isCompleted ?? false),
      due: t.due?.string ?? t.due?.date ?? null,
    };
  }

  async listTasks(filter?: string): Promise<TodoistTask[]> {
    const res = await this.api.getTasks({});
    const tasks = (Array.isArray(res) ? res : (res?.results ?? [])).map(TodoistClient.map);
    if (!filter) return tasks;
    const needle = filter.toLowerCase();
    return tasks.filter((t) => t.content.toLowerCase().includes(needle));
  }

  async addTask(content: string, opts: { dueString?: string } = {}): Promise<TodoistTask> {
    const task = await this.api.addTask({
      content,
      ...(opts.dueString ? { dueString: opts.dueString } : {}),
    });
    return TodoistClient.map(task);
  }

  /**
   * Find a task from a spoken description.
   *
   * Substring matching alone was hopeless for speech - "the ID card thing" never
   * matches "Renew national ID card". This scores on token overlap with a
   * containment bias, and returns near-ties as `alternatives` so the caller can
   * ask rather than silently acting on the wrong task. Completing the wrong task
   * is not recoverable by the user in the moment, so guessing is the wrong default.
   */
  async findTask(description: string): Promise<TaskMatch | null> {
    const tasks = await this.listTasks();
    if (tasks.length === 0) return null;

    const scored = tasks
      .map((task) => ({ task, score: similarity(description, task.content) }))
      .filter((s) => s.score > 0.25)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    const best = scored[0];
    const alternatives = scored.slice(1).filter((s) => best.score - s.score < 0.15);
    return { task: best.task, alternatives: alternatives.map((a) => a.task) };
  }

  async completeTaskByDescription(description: string): Promise<TodoistTask | null> {
    const match = await this.findTask(description);
    if (!match) return null;
    await this.api.closeTask(match.task.id);
    return { ...match.task, isCompleted: true };
  }

  async updateTaskByDescription(
    description: string,
    updates: { content?: string; dueString?: string }
  ): Promise<TodoistTask | null> {
    const match = await this.findTask(description);
    if (!match) return null;
    const updated = await this.api.updateTask(match.task.id, {
      ...(updates.content ? { content: updates.content } : {}),
      ...(updates.dueString ? { dueString: updates.dueString } : {}),
    });
    return TodoistClient.map(updated);
  }
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "your",
  "that",
  "this",
  "thing",
  "to",
  "for",
  "of",
  "on",
  "in",
  "and",
  "is",
  "it",
  "task",
  "please",
]);

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

/**
 * Containment-biased overlap.
 *
 * Normalising by the SMALLER token set means a short spoken phrase fully
 * contained in a longer task title scores 1.0, rather than being punished for the
 * title's extra words - which is exactly the failure mode of dividing by the
 * larger set.
 */
export function similarity(spoken: string, candidate: string): number {
  const a = new Set(tokenise(spoken));
  const b = new Set(tokenise(candidate));
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) {
      overlap++;
      continue;
    }
    // Credit a stem-ish prefix match so "registration" finds "register".
    for (const u of b) {
      if (
        u.length >= 4 &&
        t.length >= 4 &&
        (u.startsWith(t.slice(0, 4)) || t.startsWith(u.slice(0, 4)))
      ) {
        overlap += 0.5;
        break;
      }
    }
  }
  return overlap / Math.min(a.size, b.size);
}
