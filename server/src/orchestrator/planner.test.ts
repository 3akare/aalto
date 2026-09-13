import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardPlan, type PlannedTask } from "./planner";

const task = (id: string, tool: string, input: Record<string, unknown> = {}): PlannedTask =>
  ({ id, tool, input }) as PlannedTask;

describe("guardPlan", () => {
  it("drops a submit that arrives alongside field fills", () => {
    const out = guardPlan([
      task("t1", "fill_form_field", { fieldLabel: "Name", value: "Ada" }),
      task("t2", "submit_form"),
    ]);
    assert.equal(
      out.some((t) => t.tool === "submit_form"),
      false
    );
  });

  it("explains itself rather than silently ignoring the request", () => {
    const out = guardPlan([task("t1", "fill_form_field"), task("t2", "submit_form")]);
    const clarify = out.find((t) => t.tool === "clarify");
    assert.ok(clarify, "the dropped submit should become a clarify");
    assert.match(String(clarify?.input.question), /read it back/i);
  });

  it("keeps the fills that came with it", () => {
    const out = guardPlan([
      task("t1", "fill_form_field", { fieldLabel: "Name" }),
      task("t2", "fill_form_field", { fieldLabel: "Phone" }),
      task("t3", "submit_form"),
    ]);
    assert.equal(out.filter((t) => t.tool === "fill_form_field").length, 2);
  });

  it("allows a submit on its own — a deliberate, separate request", () => {
    const out = guardPlan([task("t1", "submit_form")]);
    assert.deepEqual(
      out.map((t) => t.tool),
      ["submit_form"]
    );
  });

  it("allows submit alongside a review, which is the whole point", () => {
    const out = guardPlan([task("t1", "review_form"), task("t2", "submit_form")]);
    assert.equal(
      out.some((t) => t.tool === "submit_form"),
      true
    );
  });

  it("leaves plans with no form activity untouched", () => {
    const tasks = [task("t1", "todoist_add"), task("t2", "answer")];
    assert.deepEqual(guardPlan(tasks), tasks);
  });
});
