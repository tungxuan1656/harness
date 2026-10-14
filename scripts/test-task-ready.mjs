import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categorizeTasks,
  extractTaskDependency,
  formatReport,
  parseTask,
  readiness,
  selfCheck,
  validateTaskGraph,
} from "../skills/harness/scripts/task-ready.mjs";

test("task-ready selfCheck suite passes", () => {
  assert.doesNotThrow(() => selfCheck());
});

test("extractTaskDependency identifies task targets and rejects non-task paths", () => {
  assert.equal(extractTaskDependency("task-foo.md"), "task-foo.md");
  assert.equal(extractTaskDependency("./task-foo.md"), "task-foo.md");
  assert.equal(extractTaskDependency("task-foo.md#acceptance"), "task-foo.md");
  assert.equal(extractTaskDependency("./task-foo.md#section"), "task-foo.md");
  assert.equal(extractTaskDependency("../tasks/task-foo.md"), "task-foo.md");
  assert.equal(extractTaskDependency("tasks/task-foo.md"), "task-foo.md");

  assert.equal(extractTaskDependency("//example.com/team/tasks/task-foo.md"), null);
  assert.equal(extractTaskDependency("/team/tasks/task-foo.md"), null);
  assert.equal(extractTaskDependency("../../other-repo/tasks/task-foo.md"), null);
  assert.equal(extractTaskDependency("../docs/spec.md"), null);
  assert.equal(extractTaskDependency("docs/spec.md"), null);
  assert.equal(extractTaskDependency("https://example.com/spec.md"), null);
  assert.equal(extractTaskDependency(""), null);
});

test("non-task markdown links are treated as manual gates without failing graph validation", () => {
  const taskA = parseTask(
    "task-a.md",
    "# a - First\n- Status: done\n- Required to start: none\n\n## Handoff\n- Blockers: none\n",
  );
  const taskB = parseTask(
    "task-b.md",
    "# b - Second\n- Status: todo\n- Required to start: [First](task-a.md) and [Approved spec](../docs/spec.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(taskB.dependencies, ["task-a.md"]);
  assert.equal(taskB.manualGate, true);

  const byFile = validateTaskGraph([taskA, taskB]);
  assert.equal(readiness(taskB, byFile), "review start gate");
});

test("task links with anchors and relative paths are normalized", () => {
  const task = parseTask(
    "task-b.md",
    "# b - Second\n- Status: todo\n- Required to start: [A](./task-a.md#acceptance), [C](../tasks/task-c.md#scope)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(task.dependencies, ["task-a.md", "task-c.md"]);
  assert.equal(task.manualGate, false);
});

test("natural language conjunctions and punctuation do not trigger manual gate", () => {
  const task1 = parseTask(
    "task-b.md",
    "# b - Second\n- Status: todo\n- Required to start: [A](task-a.md) and [C](task-c.md).\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(task1.dependencies, ["task-a.md", "task-c.md"]);
  assert.equal(task1.manualGate, false);

  const task2 = parseTask(
    "task-d.md",
    "# d - Fourth\n- Status: todo\n- Required to start: [A](task-a.md) & [C](task-c.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.equal(task2.manualGate, false);
});

test("recognizes blockers under '## Verification and handoff' heading", () => {
  const task = parseTask(
    "task-a.md",
    "# a - Task\n- Status: todo\n- Required to start: none\n\n## Verification and handoff\n\n- Evidence: verified\n- Blockers: none\n- Next: begin implementation\n",
  );
  assert.equal(task.blockerState, "none");
  const byFile = new Map([["task-a.md", task]]);
  assert.equal(readiness(task, byFile), "yes");
});

test("disjunctive 'or' operator triggers review start gate instead of mandatory AND", () => {
  const taskA = parseTask(
    "task-a.md",
    "# a - First\n- Status: active\n- Required to start: none\n\n## Handoff\n- Blockers: none\n",
  );
  const taskB = parseTask(
    "task-b.md",
    "# b - Second\n- Status: done\n- Required to start: none\n\n## Handoff\n- Blockers: none\n",
  );
  const taskC = parseTask(
    "task-c.md",
    "# c - Third\n- Status: todo\n- Required to start: [A](task-a.md) or [B](task-b.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.equal(taskC.hasOr, true);
  assert.equal(taskC.manualGate, true);
  const byFile = validateTaskGraph([taskA, taskB, taskC]);
  assert.equal(readiness(taskC, byFile), "review start gate");
});

test("headings level 3 to 6 isolate current blockers from historical snapshots", () => {
  const taskLevel4 = parseTask(
    "task-h4.md",
    "# h4 - Handoff\n- Status: todo\n- Required to start: none\n\n## Handoff\n\n- Blockers: none\n\n#### Historical snapshot\n\n- Blockers: old issue\n",
  );
  assert.equal(taskLevel4.blockerState, "none");

  const taskLevel5 = parseTask(
    "task-h5.md",
    "# h5 - Handoff\n- Status: todo\n- Required to start: none\n\n## Verification and handoff\n\n- Blockers: none\n\n##### Deep snapshot\n\n- Blockers: deep issue\n",
  );
  assert.equal(taskLevel5.blockerState, "none");
});

test("categorizeTasks and formatReport include active, ready, and blocked sections", () => {
  const taskDone = parseTask(
    "task-a.md",
    "# a - Done Task\n- Status: done\n- Required to start: none\n\n## Handoff\n- Blockers: none\n",
  );
  const taskActive = parseTask(
    "task-b.md",
    "# b - Active Task\n- Owner: alice\n- Status: active\n- Required to start: none\n\n## Handoff\n- Blockers: none\n",
  );
  const taskReady = parseTask(
    "task-c.md",
    "# c - Ready Task\n- Status: todo\n- Required to start: [Done](task-a.md)\n\n## Handoff\n- Blockers: none\n",
  );
  const taskWaiting = parseTask(
    "task-d.md",
    "# d - Waiting Task\n- Status: todo\n- Required to start: [Active](task-b.md)\n\n## Handoff\n- Blockers: none\n",
  );
  const tasks = [taskDone, taskActive, taskReady, taskWaiting];
  const byFile = validateTaskGraph(tasks);
  const categorized = categorizeTasks(tasks, byFile);

  assert.equal(categorized.active.length, 1);
  assert.equal(categorized.ready.length, 1);
  assert.equal(categorized.waiting.length, 1);
  assert.equal(categorized.done.length, 1);

  const report = formatReport(categorized, { all: true });
  assert.match(report, /## In Progress \(Active\)/);
  assert.match(report, /## Ready To Start/);
  assert.match(report, /## Waiting \/ Blocked/);
  assert.match(report, /## Completed/);
});
