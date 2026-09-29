import assert from "node:assert/strict";
import test from "node:test";
import { extractPlanStepsFromToolOutput } from "../src/tool-plan-adapter.js";

const tool = { title: "TodoWrite", kind: "TodoWrite" };

test("completed todos stay completed and oldTodos is ignored", () => {
  const steps = extractPlanStepsFromToolOutput({
    ...tool,
    output: JSON.stringify({
      oldTodos: [
        { content: "摸底", status: "pending", priority: "high" },
        { content: "汇报", status: "pending", priority: "low" },
      ],
      todos: [
        { content: "摸底", status: "completed", priority: "high" },
        { content: "汇报", status: "pending", priority: "low" },
      ],
      summary: { total: 2, pending: 1, inProgress: 0, completed: 1 },
    }),
  });

  assert.deepEqual(
    steps?.map((step) => [step.title, step.status]),
    [
      ["摸底", "completed"],
      ["汇报", "pending"],
    ],
  );
});

test("inProgress does not drop sibling completed items", () => {
  const steps = extractPlanStepsFromToolOutput({
    ...tool,
    output: {
      todos: [
        { content: "摸底", status: "completed" },
        { content: "核对", status: "inProgress" },
        { content: "汇报", status: "done" },
      ],
    },
  });

  assert.deepEqual(
    steps?.map((step) => step.status),
    ["completed", "in_progress", "completed"],
  );
});

test("an unrecognized status stays pending instead of discarding the list", () => {
  const steps = extractPlanStepsFromToolOutput({
    ...tool,
    output: {
      text: JSON.stringify({
        todos: [
          { content: "摸底", status: "completed" },
          { content: "核对", status: "weird" },
        ],
      }),
    },
  });

  assert.deepEqual(
    steps?.map((step) => step.status),
    ["completed", "pending"],
  );
});
