import axios from "axios";

export interface TodoistTask {
  id: string;
  content: string;
  isCompleted: boolean;
  due?: string | null;
}

/**
 * Thin wrapper over the Todoist REST API v2.
 * Docs: https://developer.todoist.com/rest/v2
 */
export class TodoistClient {
  private baseUrl = "https://api.todoist.com/rest/v2";

  constructor(private apiToken: string) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async addTask(content: string, opts: { dueString?: string } = {}): Promise<TodoistTask> {
    const res = await axios.post(
      `${this.baseUrl}/tasks`,
      { content, due_string: opts.dueString },
      { headers: this.headers() }
    );
    return this.mapTask(res.data);
  }

  async listTasks(filterText?: string): Promise<TodoistTask[]> {
    const res = await axios.get(`${this.baseUrl}/tasks`, { headers: this.headers() });
    const tasks: TodoistTask[] = res.data.map(this.mapTask);
    if (!filterText) return tasks;
    const needle = filterText.toLowerCase();
    return tasks.filter((t) => t.content.toLowerCase().includes(needle));
  }

  /** Fuzzy-find a task by spoken description, then mark it complete. */
  async completeTaskByDescription(description: string): Promise<TodoistTask | null> {
    const matches = await this.listTasks(description);
    if (matches.length === 0) return null;
    const target = matches[0];
    await axios.post(`${this.baseUrl}/tasks/${target.id}/close`, {}, { headers: this.headers() });
    return { ...target, isCompleted: true };
  }

  /** Fuzzy-find a task by spoken description, then update its content and/or due date. */
  async updateTaskByDescription(
    description: string,
    updates: { content?: string; dueString?: string }
  ): Promise<TodoistTask | null> {
    const matches = await this.listTasks(description);
    if (matches.length === 0) return null;
    const target = matches[0];
    const res = await axios.post(
      `${this.baseUrl}/tasks/${target.id}`,
      { content: updates.content, due_string: updates.dueString },
      { headers: this.headers() }
    );
    return this.mapTask(res.data ?? { ...target, content: updates.content ?? target.content });
  }

  private mapTask(raw: any): TodoistTask {
    return {
      id: raw.id,
      content: raw.content,
      isCompleted: raw.is_completed ?? false,
      due: raw.due?.string ?? null,
    };
  }
}
