import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "harness-validator-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(new URL("../skills/", import.meta.url), join(root, "skills"), { recursive: true });
  for (const name of ["README.md", "LICENSE"]) {
    cpSync(new URL(`../${name}`, import.meta.url), join(root, name));
  }
  mkdirSync(join(root, "scripts"));
  cpSync(new URL("./validate-skill-family.mjs", import.meta.url), join(root, "scripts/validate-skill-family.mjs"));
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [join(root, "scripts/validate-skill-family.mjs")], { encoding: "utf8" });
}

test("validator accepts packaged v2, including template and fenced example links", (t) => {
  const result = run(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS agent-docs-checker/);
  assert.match(result.stdout, /PASS repo-skills/);
  assert.match(result.stdout, /PASS skill family layout and local routes/);
});

test("broken local documentation route fails validation", (t) => {
  const root = fixture(t);
  const path = join(root, "skills/agent-docs-checker/SKILL.md");
  writeFileSync(path, readFileSync(path, "utf8") + "\n[Broken route](missing-document.md)\n");
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /broken local link missing-document.md/);
});

test("malformed JSON reaches the top-level failure handler", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "skills/harness/metadata.json"), "{invalid");
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON|property name/i);
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection/);
});

test("duplicate evaluation IDs fail rather than silently dropping cases", (t) => {
  const root = fixture(t);
  const path = join(root, "skills/agent-docs-checker/evals/evals.json");
  const corpus = JSON.parse(readFileSync(path, "utf8"));
  corpus.evals[1].id = corpus.evals[0].id;
  writeFileSync(path, JSON.stringify(corpus));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate eval id/);
});

for (const name of ["find-skills", "simple-english"]) {
  test(`removed ${name} cannot reappear in the package`, (t) => {
    const root = fixture(t);
    mkdirSync(join(root, "skills", name));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Removed skill remains packaged: .*${name}`));
  });
}

test("index cannot mirror mutable task status", (t) => {
  const root = fixture(t);
  const path = join(root, "skills/harness/templates/task-index.md");
  writeFileSync(path, readFileSync(path, "utf8") + "\n- Status: active\n");
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not mirror task state/);
});

test("task template must include a persistent ID field", (t) => {
  const root = fixture(t);
  const path = join(root, "skills/harness/templates/task-template.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("- ID: {{TASK_NUMBER}}\n", ""));
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing ID/);
});
