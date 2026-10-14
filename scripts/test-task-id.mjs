import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allocateTasks, resolveTask } from "../skills/harness/scripts/task-id.mjs";
import { categorizeTasks, formatReport, parseTask, validateTaskGraph } from "../skills/harness/scripts/task-ready.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "harness-task-ids-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const legacy = (id, status = "todo", start = "none") =>
  `# task-${id} - ${id}\n\n- Status: ${status}\n- Owner: alice\n- Required to start: ${start}\n- Required to integrate/release: none\n\n## Handoff\n- Blockers: none\n`;
const numbered = (id, number, status, start) => legacy(id, status, start).replace("- Status:", `- ID: ${number}\n- Status:`);
const script = new URL("../skills/harness/scripts/task-id.mjs", import.meta.url);

function cli(...args) {
  return spawnSync(process.execPath, [script.pathname, ...args], { encoding: "utf8" });
}

test("migration is deterministic, additive, idempotent and supports old references", async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, "task-b.md"), legacy("b", "todo", "[a](task-a.md)"));
  await writeFile(join(dir, "task-a.md"), legacy("a", "done"));
  const assigned = await allocateTasks(dir);
  assert.deepEqual(assigned.map(({ file, ref }) => [file, ref]), [["task-a.md", "#1"], ["task-b.md", "#2"]]);
  const text = await readFile(join(dir, "task-a.md"), "utf8");
  assert.equal(text.replace("\n- ID: 1\n", ""), legacy("a", "done"));
  assert.deepEqual(await allocateTasks(dir), []);
  assert.equal(await readFile(join(dir, "task-a.md"), "utf8"), text);
  for (const ref of ["#1", "task-a", "task-a.md"]) assert.equal((await resolveTask(dir, ref)).number, 1);
  assert.equal((await resolveTask(dir, "#2")).dependencies[0], "task-a.md");
  assert.deepEqual(JSON.parse(await readFile(join(dir, ".task-ids.json"), "utf8")), { nextId: 3 });
});

test("creation uses the template and does not reuse deleted IDs; rename retains identity", async (t) => {
  const dir = await fixture(t);
  const create = (slug) => allocateTasks(dir, { slug, title: `Title ${slug}`, owner: "alice" });
  const [first] = await create("first");
  assert.equal(first.ref, "#1");
  const text = await readFile(join(dir, first.file), "utf8");
  assert.match(text, /## Acceptance/);
  assert.doesNotMatch(text, /\{\{TASK_|\{\{HARNESS_VERSION/);
  await rename(join(dir, first.file), join(dir, "task-renamed.md"));
  assert.equal((await resolveTask(dir, "#1")).file, "task-renamed.md");
  await rm(join(dir, "task-renamed.md"));
  const [second] = await create("second");
  assert.equal(second.ref, "#2");
  await assert.rejects(create("second"), /already exists/);
  assert.equal((await resolveTask(dir, "#2")).owner, "alice");
});

test("numeric and legacy dependency links resolve identically and show short references", () => {
  const a = parseTask("task-a.md", numbered("a", 42, "done"));
  const b = parseTask("task-b.md", numbered("b", 43, "active", "#42"));
  const c = parseTask("task-c.md", numbered("c", 44, "todo", "#42 and [#43 - b](task-b.md)"));
  const d = parseTask("task-d.md", numbered("d", 45, "todo", "#42"));
  const tasks = [a, b, c, d];
  const byFile = validateTaskGraph(tasks);
  assert.deepEqual(c.dependencies, ["task-b.md", "task-a.md"]);
  assert.equal(c.manualGate, false);
  const report = formatReport(categorizeTasks(tasks, byFile), { all: true });
  assert.match(report, /\[READY\] \[#45\] d \(deps: #42/);
  assert.match(report, /waiting on: #43 \(active\)/);
  assert.match(report, /\[DONE\] \[#42\]/);
  assert.doesNotMatch(report, /\[task-/);
  assert.equal(a.id, "task-a");
});

test("invalid, duplicate, missing, self and cyclic IDs fail safely", async (t) => {
  for (const value of ["", "0", "-1", "1.5", "01", "9007199254740992", "{{TASK_NUMBER}}"]) {
    assert.throws(() => parseTask("task-a.md", numbered("a", value)), /positive safe integer/);
  }
  assert.throws(() => parseTask("task-a.md", numbered("a", "1\n- ID: 2")), /at most one ID/);
  assert.throws(() => validateTaskGraph([
    parseTask("task-a.md", numbered("a", 1)), parseTask("task-b.md", numbered("b", 1)),
  ]), /Duplicate numeric/);
  assert.throws(() => validateTaskGraph([parseTask("task-a.md", numbered("a", 1, "todo", "#99"))]), /unknown dependency #99/);
  assert.throws(() => validateTaskGraph([parseTask("task-a.md", numbered("a", 1, "todo", "#1"))]), /depends on itself/);
  assert.throws(() => validateTaskGraph([
    parseTask("task-a.md", numbered("a", 1, "todo", "#2")),
    parseTask("task-b.md", numbered("b", 2, "todo", "#1")),
  ]), /Dependency cycle/);
  const dir = await fixture(t);
  await assert.rejects(allocateTasks(dir, { slug: "../escape", title: "Bad", owner: "alice" }), /Slug/);
  await assert.rejects(allocateTasks(dir, { slug: "ok", title: "Bad\nTitle", owner: "alice" }), /Title/);
  await writeFile(join(dir, "task-a.md"), numbered("a", 5));
  await assert.rejects(allocateTasks(dir), /counter missing/);
  await writeFile(join(dir, ".task-ids.json"), '{"nextId":0}');
  await assert.rejects(allocateTasks(dir), /Invalid task ID counter/);
  await writeFile(join(dir, ".task-ids.json"), '{"nextId":20}');
  const [task] = await allocateTasks(dir, { slug: "next", title: "Next", owner: "alice" });
  assert.equal(task.ref, "#20");
});

test("CLI creates, migrates and resolves quoted IDs with meaningful failures", async (t) => {
  const dir = await fixture(t);
  const result = cli("create", dir, "export-csv", "Export CSV", "alice");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /#1 - Export CSV/);
  const resolved = cli("resolve", dir, "#1");
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(JSON.parse(resolved.stdout).file, "task-export-csv.md");
  assert.equal(cli("assign", dir).status, 0);
  const missing = cli("resolve", dir, "#99");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /found 0/);
  await mkdir(join(dir, ".task-ids.lock"));
  const locked = cli("create", dir, "other", "Other", "bob");
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /allocator locked/);
});

test("concurrent writers allocate distinct IDs or fail explicitly for retry", async (t) => {
  const dir = await fixture(t);
  const run = (slug) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script.pathname, "create", dir, slug, slug, "alice"]);
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr, slug }));
  });
  const results = await Promise.all([run("one"), run("two"), run("three")]);
  for (const result of results) {
    if (result.status !== 0) {
      assert.match(result.stderr, /allocator locked/);
      const retry = cli("create", dir, result.slug, result.slug, "alice");
      assert.equal(retry.status, 0, retry.stderr);
    }
  }
  const tasks = await Promise.all(["one", "two", "three"].map((slug) => resolveTask(dir, `task-${slug}`)));
  assert.deepEqual(tasks.map(({ number }) => number).sort(), [1, 2, 3]);
});

test("migration handles leading comments, blank lines and CRLF without changing history", async (t) => {
  const dir = await fixture(t);
  const original = "<!-- retained history -->\n\n" + legacy("preamble").replaceAll("\n", "\r\n");
  const path = join(dir, "task-preamble.md");
  await writeFile(path, original);
  const [task] = await allocateTasks(dir);
  assert.equal(task.number, 1);
  assert.equal((await readFile(path, "utf8")).replace("\n- ID: 1\n", ""), original);
  assert.deepEqual(await allocateTasks(dir), []);
});

test("external issue numbers in links stay manual gates, not local dependencies", () => {
  for (const target of ["https://github.com/org/repo/issues/42", "../docs/spec.md#42", "//example.com/#42"]) {
    const task = parseTask("task-external.md", numbered("external", 1, "todo", `[#42](${target})`));
    assert.deepEqual(task.dependencies, []);
    assert.equal(task.manualGate, true);
    assert.doesNotThrow(() => validateTaskGraph([task]));
    const local = parseTask("task-local.md", numbered("local", 42, "done"));
    assert.doesNotThrow(() => validateTaskGraph([task, local]));
    assert.deepEqual(task.dependencies, []);
  }
});

test("a partial creation write never publishes a malformed task and leaves a reserved gap", async (t) => {
  const dir = await fixture(t);
  const probe = await open(join(dir, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe);
  const original = prototype.writeFile;
  await probe.close();
  prototype.writeFile = async function () {
    await this.write("# truncated");
    throw new Error("simulated disk-full write");
  };
  try {
    await assert.rejects(allocateTasks(dir, { slug: "failed", title: "Failed", owner: "alice" }), /simulated disk-full/);
  } finally {
    prototype.writeFile = original;
  }
  for (const name of ["task-failed.md", "task-failed.md.tmp", ".task-ids.lock"]) {
    await assert.rejects(readFile(join(dir, name)), { code: "ENOENT" });
  }
  const [task] = await allocateTasks(dir, { slug: "retry", title: "Retry", owner: "alice" });
  assert.equal(task.number, 2);
});
