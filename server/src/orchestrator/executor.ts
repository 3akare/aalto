import type { TodoistClient } from "../integrations/todoist";
import type { PlannedTask } from "./planner";
import { isServerSide } from "./tools";

/**
 * Runs a plan's tasks.
 *
 * Server-side tasks (Todoist, clarify) execute here, concurrently. Browser-side
 * tasks are returned for the extension to run, because only it has chrome.tabs
 * and page DOM access.
 *
 * One failed task must never sink the batch - the user asked for three things and
 * should get the two that worked plus an honest account of the third.
 */

export type TaskStatus = "ok" | "failed" | "needs_input" | "pending";

export interface TaskResult {
  id: string;
  tool: string;
  status: TaskStatus;
  /** One short clause, phrased for reading aloud. */
  detail: string;
}

export interface ExecutionSplit {
  serverResults: TaskResult[];
  browserTasks: PlannedTask[];
}

export async function executePlan(
  tasks: readonly PlannedTask[],
  todoist: TodoistClient
): Promise<ExecutionSplit> {
  const serverTasks = tasks.filter((t) => isServerSide(t.tool));
  const browserTasks = tasks.filter((t) => !isServerSide(t.tool));

  const settled = await Promise.allSettled(serverTasks.map((task) => runServerTask(task, todoist)));

  const serverResults: TaskResult[] = settled.map((outcome, i) => {
    const task = serverTasks[i];
    if (outcome.status === "fulfilled") return outcome.value;
    const reason =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    return {
      id: task.id,
      tool: task.tool,
      status: "failed",
      detail: `couldn't ${describe(task.tool)}: ${reason}`,
    };
  });

  return { serverResults, browserTasks };
}

async function runServerTask(task: PlannedTask, todoist: TodoistClient): Promise<TaskResult> {
  const base = { id: task.id, tool: task.tool };

  switch (task.tool) {
    case "todoist_add": {
      const added = await todoist.addTask(task.input.content as string, {
        dueString: task.input.dueString as string | undefined,
      });
      return {
        ...base,
        status: "ok",
        detail: `added "${added.content}"${added.due ? ` for ${added.due}` : ""} to your tasks`,
      };
    }

    case "todoist_complete": {
      const description = task.input.description as string;
      const match = await todoist.findTask(description);
      if (!match) {
        return { ...base, status: "failed", detail: `couldn't find a task like "${description}"` };
      }
      // Completing the wrong task is not something the user can undo in the
      // moment, so an ambiguous match asks rather than picking the top score.
      if (match.alternatives.length > 0) {
        const options = [match.task, ...match.alternatives].map((t) => `"${t.content}"`);
        return {
          ...base,
          status: "needs_input",
          detail: `did you mean ${options.slice(0, 3).join(", or ")}?`,
        };
      }
      await todoist.completeTaskByDescription(description);
      return { ...base, status: "ok", detail: `marked "${match.task.content}" done` };
    }

    case "todoist_update": {
      const description = task.input.description as string;
      const match = await todoist.findTask(description);
      if (!match) {
        return { ...base, status: "failed", detail: `couldn't find a task like "${description}"` };
      }
      if (match.alternatives.length > 0) {
        const options = [match.task, ...match.alternatives].map((t) => `"${t.content}"`);
        return {
          ...base,
          status: "needs_input",
          detail: `did you mean ${options.slice(0, 3).join(", or ")}?`,
        };
      }
      const updated = await todoist.updateTaskByDescription(description, {
        content: task.input.newContent as string | undefined,
        dueString: task.input.newDueString as string | undefined,
      });
      return {
        ...base,
        status: "ok",
        detail: `updated it to "${updated?.content}"${updated?.due ? `, due ${updated.due}` : ""}`,
      };
    }

    case "clarify":
      return { ...base, status: "needs_input", detail: task.input.question as string };

    default:
      return { ...base, status: "failed", detail: `don't know how to ${task.tool}` };
  }
}

function describe(tool: string): string {
  switch (tool) {
    case "todoist_add":
      return "add that task";
    case "todoist_complete":
      return "complete that task";
    case "todoist_update":
      return "update that task";
    default:
      return `run ${tool}`;
  }
}
