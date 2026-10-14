#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function extractTaskDependency(target) {
  if (!target || typeof target !== "string") return null;
  const trimmed = target.trim();
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(trimmed)) return null;

  const cleanPath = trimmed.split(/[?#]/)[0].replace(/^\.\//, "");
  if (/^task-[^/]+\.md$/i.test(cleanPath)) {
    return cleanPath;
  }
  const match = cleanPath.match(/^(?:\.\.\/)?tasks\/(task-[^/]+\.md)$/i);
  if (match) {
    return match[1];
  }
  return null;
}

export function parseTask(file, text) {
  const header = text.split(/^## /m)[0];
  const title = header.match(/^# (.+?) - (.+)\r?$/m);
  assert(title, `${file}: expected '# ID - Title'`);
  const field = (name) => {
    const matches = [...header.matchAll(new RegExp(`^- ${name}: (.+)\\r?$`, "gm"))];
    assert.equal(matches.length, 1, `${file}: expected one ${name} field`);
    const value = matches[0][1].trim();
    assert(value, `${file}: expected non-empty ${name} field`);
    return value;
  };
  const status = field("Status");
  assert(
    ["todo", "active", "blocked", "done"].includes(status),
    `${file}: invalid status ${status}`,
  );
  const start = field("Required to start").replace(/<!--[\s\S]*?-->/g, "").trim();
  const hasOr = /\bor\b/i.test(start);
  const dependencies = [];
  const remainingGate = start
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, (match, target) => {
      const taskDep = extractTaskDependency(target);
      if (taskDep) {
        dependencies.push(taskDep);
        return "";
      }
      return match;
    })
    .replace(/\b(?:and)\b/gi, "")
    .replace(/[&+,;.\s\-–—/()]/g, "");
  const manualGate =
    hasOr || (!/^none\.?$/i.test(start.trim()) && (!dependencies.length || Boolean(remainingGate)));

  // Historical snapshots below Handoff must not override current blockers.
  const handoff =
    text.split(/^##\s+(?:Verification and\s+)?[Hh]andoff\b[^\n]*\r?$/m)[1]?.split(/^#{2,6}\s+/m)[0] ?? "";
  const blockers = [...handoff.replaceAll("**", "").matchAll(/^- Blockers:\s*(.+)\r?$/gm)];
  assert(blockers.length <= 1, `${file}: expected at most one current Blockers field`);
  const blocker = blockers[0]?.[1].trim();
  let blockerState = "blocked";
  if (!blocker || /^(?:not evaluated|unknown|not assessed)\b/i.test(blocker)) {
    blockerState = "unreviewed";
  } else if (/^none\.?$/i.test(blocker)) {
    blockerState = "none";
  }

  const ownerMatches = [...header.matchAll(/^- Owner: (.+)\r?$/gm)];
  const owner = ownerMatches[0]?.[1]?.trim() || "unassigned";

  return {
    file,
    id: title[1].trim(),
    title: title[2].trim(),
    owner,
    status,
    start,
    dependencies,
    manualGate,
    hasOr,
    blockerState,
    blockerText: blocker || "none",
  };
}

export function readiness(task, byFile) {
  if (task.status !== "todo") return "-";
  if (task.hasOr) return "review start gate";
  if (task.dependencies.some((file) => byFile.get(file).status !== "done")) return "no";
  if (task.manualGate) return "review start gate";
  if (task.blockerState === "blocked") return "no (blocker)";
  return task.blockerState === "unreviewed" ? "review blockers" : "yes";
}

export function validateTaskGraph(tasks) {
  const byFile = new Map(tasks.map((task) => [task.file, task]));
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length, "Duplicate task IDs");
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      assert(byFile.has(dependency), `${task.file}: unknown dependency ${dependency}`);
      assert.notEqual(dependency, task.file, `${task.file}: task depends on itself`);
    }
  }
  const visited = new Set();
  const visiting = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    assert(!visiting.has(file), `Dependency cycle: ${[...visiting, file].join(" -> ")}`);
    visiting.add(file);
    for (const dependency of byFile.get(file).dependencies) visit(dependency);
    visiting.delete(file);
    visited.add(file);
  };
  for (const task of tasks) visit(task.file);
  return byFile;
}

export function categorizeTasks(tasks, byFile) {
  const active = [];
  const ready = [];
  const reviewBlockers = [];
  const waiting = [];
  const blocked = [];
  const done = [];

  for (const task of tasks) {
    if (task.status === "active") {
      active.push(task);
      continue;
    }
    if (task.status === "done") {
      done.push(task);
      continue;
    }
    if (task.status === "blocked") {
      blocked.push(task);
      continue;
    }

    const state = readiness(task, byFile);
    if (state === "yes") {
      ready.push(task);
    } else if (state === "review blockers") {
      reviewBlockers.push(task);
    } else if (state === "review start gate" || state === "no (blocker)") {
      blocked.push({ ...task, reason: state });
    } else {
      const pendingDeps = task.dependencies
        .filter((dep) => byFile.get(dep).status !== "done")
        .map((dep) => `${byFile.get(dep).id} (${byFile.get(dep).status})`);
      waiting.push({ ...task, pendingDeps });
    }
  }

  return { active, ready, reviewBlockers, waiting, blocked, done };
}

export function formatReport(categorized, options = {}) {
  const lines = [];

  if (categorized.active.length > 0) {
    lines.push("## In Progress (Active)");
    for (const task of categorized.active) {
      lines.push(`- [${task.id}] ${task.title} (owner: ${task.owner}, file: ${task.file})`);
    }
    lines.push("");
  }

  lines.push("## Ready To Start");
  if (categorized.ready.length === 0 && categorized.reviewBlockers.length === 0) {
    lines.push("No tasks currently ready to start.");
  } else {
    for (const task of categorized.ready) {
      const deps = task.dependencies.length ? `deps: ${task.dependencies.join(", ")}` : "no deps";
      lines.push(`- [READY] [${task.id}] ${task.title} (${deps}, owner: ${task.owner})`);
    }
    for (const task of categorized.reviewBlockers) {
      lines.push(`- [REVIEW BLOCKERS] [${task.id}] ${task.title} (blocker: ${task.blockerText}, owner: ${task.owner})`);
    }
  }
  lines.push("");

  if (categorized.waiting.length > 0 || categorized.blocked.length > 0) {
    lines.push("## Waiting / Blocked");
    for (const task of categorized.waiting) {
      lines.push(`- [WAITING] [${task.id}] ${task.title} (waiting on: ${task.pendingDeps.join(", ")})`);
    }
    for (const task of categorized.blocked) {
      const reason = task.reason || task.blockerText || "blocked";
      lines.push(`- [BLOCKED] [${task.id}] ${task.title} (${reason})`);
    }
    lines.push("");
  }

  if (options.all && categorized.done.length > 0) {
    lines.push("## Completed");
    for (const task of categorized.done) {
      lines.push(`- [DONE] [${task.id}] ${task.title}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function selfCheck() {
  const fixture = (id, status, start = "none", blockers = "none.") =>
    parseTask(
      `task-${id}.md`,
      `# ${id} - Example | title\n- Owner: dev\n- Status: ${status}\n- Required to start: ${start}\n\n## Handoff\n\n- Blockers: ${blockers}\n\n### Historical snapshot\n\n- Status: blocked\n- Blockers: historical issue\n`,
    );
  const done = fixture("a", "done");
  const ready = fixture("b", "todo", "[a](task-a.md)");
  const waiting = fixture("c", "todo", "[b](task-b.md)");
  const unknown = fixture("d", "todo", "none", "not evaluated until selection.");
  const blocked = fixture("e", "todo", "none", "Awaiting supplied source.");
  const manual = fixture("f", "todo", "owner approval");
  const tasks = [done, ready, waiting, unknown, blocked, manual];
  const byFile = validateTaskGraph(tasks);

  assert.deepEqual(
    tasks.map((task) => readiness(task, byFile)),
    ["-", "yes", "no", "review blockers", "no (blocker)", "review start gate"],
  );

  const categorized = categorizeTasks(tasks, byFile);
  assert.equal(categorized.ready.length, 1);
  assert.equal(categorized.ready[0].id, "b");
  assert.equal(categorized.reviewBlockers.length, 1);
  assert.equal(categorized.reviewBlockers[0].id, "d");
  assert.equal(categorized.waiting.length, 1);
  assert.equal(categorized.waiting[0].id, "c");
  assert.equal(categorized.done.length, 1);
  assert.equal(categorized.done[0].id, "a");

  const report = formatReport(categorized);
  assert(report.includes("[READY] [b] Example | title"));
  assert(report.includes("[REVIEW BLOCKERS] [d] Example | title"));
  assert(report.includes("[WAITING] [c] Example | title"));

  assert.throws(
    () => validateTaskGraph([fixture("a", "todo", "[missing](task-missing.md)")]),
    /unknown dependency/,
  );
  assert.throws(
    () => validateTaskGraph([fixture("a", "todo", "[a](task-a.md)")]),
    /depends on itself/,
  );
  assert.throws(
    () =>
      validateTaskGraph([
        fixture("a", "todo", "[b](task-b.md)"),
        fixture("b", "todo", "[a](task-a.md)"),
      ]),
    /Dependency cycle: task-a\.md -> task-b\.md -> task-a\.md/,
  );
  assert.throws(
    () =>
      validateTaskGraph([
        done,
        fixture("b", "todo", "[c](task-c.md)"),
        fixture("c", "active", "[d](task-d.md)"),
        fixture("d", "blocked", "[b](task-b.md)"),
      ]),
    /Dependency cycle: task-b\.md -> task-c\.md -> task-d\.md -> task-b\.md/,
  );
  assert.throws(() => validateTaskGraph([done, done]), /Duplicate task IDs/);
  assert.throws(() => fixture("a", "unknown"), /invalid status/);
  assert.throws(
    () => parseTask("task-a.md", "# a - Example\n- Status: todo\n"),
    /Required to start/,
  );
  assert.equal(readiness(fixture("g", "blocked"), byFile), "-");
  assert.equal(readiness(fixture("h", "active"), byFile), "-");

  const missingBlockers = parseTask(
    "task-i.md",
    "# i - Example\n- Status: todo\n- Required to start: none\n",
  );
  assert.equal(readiness(missingBlockers, byFile), "review blockers");

  const boldBlocker = parseTask(
    "task-j.md",
    "# j - Example\n- Status: todo\n- Required to start: none\n## Handoff\n- **Blockers:** awaiting source\n",
  );
  assert.equal(readiness(boldBlocker, byFile), "no (blocker)");

  assert.throws(
    () => fixture("k", "todo", "none", "none\n- Blockers: awaiting source"),
    /current Blockers/,
  );
  assert.throws(
    () =>
      parseTask(
        "task-l.md",
        "# l - Example\n- Status: todo\n- Status: done\n- Required to start: none\n",
      ),
    /one Status/,
  );
  assert.equal(
    parseTask("task-m.md", "# m - Example\r\n- Status: todo\r\n- Required to start: none\r\n")
      .title,
    "Example",
  );
  assert.throws(() => fixture("n", "todo", "  "), /non-empty Required to start/);
  assert.equal(readiness(fixture("o", "todo", ",;"), byFile), "review start gate");

  const nonTaskDep = parseTask(
    "task-p.md",
    "# p - Example\n- Status: todo\n- Required to start: [Approved spec](../docs/spec.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(nonTaskDep.dependencies, []);
  assert.equal(nonTaskDep.manualGate, true);
  assert.equal(readiness(nonTaskDep, byFile), "review start gate");

  const naturalLanguage = parseTask(
    "task-q.md",
    "# q - Example\n- Status: todo\n- Required to start: [a](./task-a.md#acceptance) and [b](task-b.md).\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(naturalLanguage.dependencies, ["task-a.md", "task-b.md"]);
  assert.equal(naturalLanguage.manualGate, false);

  const verificationHandoff = parseTask(
    "task-r.md",
    "# r - Example\n- Status: todo\n- Required to start: none\n\n## Verification and handoff\n\n- Evidence: verified\n- Blockers: none\n- Next: begin implementation\n",
  );
  assert.equal(verificationHandoff.blockerState, "none");
  assert.equal(readiness(verificationHandoff, byFile), "yes");

  const mixedGate = parseTask(
    "task-s.md",
    "# s - Example\n- Status: todo\n- Required to start: [a](task-a.md) and [RFC](docs/rfc.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(mixedGate.dependencies, ["task-a.md"]);
  assert.equal(mixedGate.manualGate, true);
  assert.equal(readiness(mixedGate, byFile), "review start gate");

  const externalProtocolRelative = parseTask(
    "task-t.md",
    "# t - Example\n- Status: todo\n- Required to start: [External](//example.com/team/tasks/task-a.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.deepEqual(externalProtocolRelative.dependencies, []);
  assert.equal(externalProtocolRelative.manualGate, true);
  assert.equal(readiness(externalProtocolRelative, byFile), "review start gate");

  const orGate = parseTask(
    "task-u.md",
    "# u - Example\n- Status: todo\n- Required to start: [A](task-a.md) or [B](task-b.md)\n\n## Handoff\n- Blockers: none\n",
  );
  assert.equal(orGate.hasOr, true);
  assert.equal(orGate.manualGate, true);
  const activeTask = fixture("active-b", "active");
  const testGraph = new Map([
    ["task-a.md", done],
    ["task-b.md", activeTask],
    ["task-u.md", orGate],
  ]);
  assert.equal(readiness(orGate, testGraph), "review start gate");

  const headingLevel4Handoff = parseTask(
    "task-v.md",
    "# v - Example\n- Status: todo\n- Required to start: none\n\n## Handoff\n\n- Blockers: none\n\n#### Historical snapshot\n\n- Blockers: historical issue\n",
  );
  assert.equal(headingLevel4Handoff.blockerState, "none");
  assert.equal(readiness(headingLevel4Handoff, byFile), "yes");

  process.stdout.write("PASS task-ready self-checks\n");
}

function resolveTasksDirectory(argDir) {
  if (argDir) return resolve(process.cwd(), argDir);
  const localTasks = resolve(process.cwd(), "tasks");
  if (existsSync(localTasks)) return localTasks;
  const parentTasks = resolve(process.cwd(), "../tasks");
  if (existsSync(parentTasks)) return parentTasks;
  return localTasks;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfCheck();
    return;
  }

  const isJson = args.includes("--json");
  const isAll = args.includes("--all");
  const dirArg = args.find((arg) => !arg.startsWith("--"));
  const tasksDirectory = resolveTasksDirectory(dirArg);

  if (!existsSync(tasksDirectory)) {
    process.stderr.write(`Tasks directory not found: ${tasksDirectory}\n`);
    process.exitCode = 1;
    return;
  }

  const entries = await readdir(tasksDirectory);
  const files = entries.filter((file) => /^task-.+\.md$/.test(file)).sort();

  if (files.length === 0) {
    if (isJson) {
      process.stdout.write(JSON.stringify({ active: [], ready: [], reviewBlockers: [], waiting: [], blocked: [], done: [] }, null, 2) + "\n");
    } else {
      process.stdout.write(`No task files found in ${tasksDirectory}\n`);
    }
    return;
  }

  const tasks = await Promise.all(
    files.map(async (file) => parseTask(file, await readFile(join(tasksDirectory, file), "utf8"))),
  );

  const byFile = validateTaskGraph(tasks);
  const categorized = categorizeTasks(tasks, byFile);

  if (isJson) {
    process.stdout.write(JSON.stringify(categorized, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(categorized, { all: isAll }) + "\n");
  }
}

const isEntrypoint = () => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
