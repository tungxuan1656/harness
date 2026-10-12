import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const template = readFileSync(new URL("../skills/harness/templates/init.sh", import.meta.url), "utf8");
const gap = 'echo "SKIP project checks: template not configured" >&2\necho "PASS configured checks (not full repository verification)"';

function repository(t, checks) {
  const directory = mkdtempSync(join(tmpdir(), "harness init "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = checks === undefined ? template : template.replace(gap, `${checks}\necho "PASS repository verification"`);
  assert(checks === undefined || script !== template, "template gap must be replaceable");
  writeFileSync(join(directory, "init.sh"), script);
  writeFileSync(join(directory, "source.txt"), "original\n");
  git(directory, "init", "--quiet");
  git(directory, "add", ".");
  git(directory, "-c", "user.name=Harness Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "baseline");
  return directory;
}

function git(directory, ...args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

function run(directory) {
  // Deliberately run outside the repo, with spaces in its path.
  return spawnSync("bash", [join(directory, "init.sh")], { cwd: tmpdir(), encoding: "utf8" });
}

test("unconfigured template passes only static checks and exposes the gap", (t) => {
  const directory = repository(t);
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /SKIP project checks: template not configured/);
  assert.match(result.stdout, /PASS configured checks \(not full repository verification\)/);
  assert.doesNotMatch(result.stdout, /PASS repository verification/);
  assert.equal(git(directory, "status", "--porcelain"), "");
});

test("configured root check runs in script directory without touching source", (t) => {
  const directory = repository(t, "run_check bash check.sh");
  writeFileSync(join(directory, "check.sh"), 'test "$PWD" = "' + directory + '"\nmkdir -p build\necho artifact > build/result.txt\n');
  const result = run(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS bash check.sh/);
  assert.match(result.stdout, /PASS repository verification/);
  assert.equal(readFileSync(join(directory, "source.txt"), "utf8"), "original\n");
  assert.equal(readFileSync(join(directory, "build/result.txt"), "utf8"), "artifact\n");
  assert.equal(git(directory, "diff", "HEAD"), "");
});

for (const failure of ["typecheck", "test"]) {
  test(`${failure} failure preserves exit status and stops later checks`, (t) => {
    const directory = repository(t, "run_check bash typecheck.sh\nrun_check bash test.sh\nrun_check bash later.sh");
    writeFileSync(join(directory, "typecheck.sh"), failure === "typecheck" ? "exit 19\n" : "exit 0\n");
    writeFileSync(join(directory, "test.sh"), "exit 19\n");
    writeFileSync(join(directory, "later.sh"), "echo SHOULD_NOT_RUN\n");
    const result = run(directory);
    assert.equal(result.status, 19, result.stderr);
    assert.match(result.stderr, new RegExp(`FAIL bash ${failure}\\.sh`));
    assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN|PASS repository verification/);
  });
}

for (const staged of [false, true]) {
  test(`${staged ? "staged" : "unstaged"} whitespace fails without fixing files`, (t) => {
    const directory = repository(t, "run_check bash later.sh");
    const source = "invalid trailing space \n";
    writeFileSync(join(directory, "source.txt"), source);
    if (staged) git(directory, "add", "source.txt");
    const result = run(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`FAIL git diff ${staged ? "--cached " : ""}--check`));
    assert.doesNotMatch(result.stdout, /RUN  bash later.sh|PASS repository verification/);
    assert.equal(readFileSync(join(directory, "source.txt"), "utf8"), source);
    if (staged) assert.equal(git(directory, "show", ":source.txt"), source);
  });
}

test("missing project command cannot report verification success", (t) => {
  const directory = repository(t, "run_check harness-command-that-does-not-exist");
  const result = run(directory);
  assert.equal(result.status, 127);
  assert.match(result.stderr, /FAIL harness-command-that-does-not-exist/);
  assert.doesNotMatch(result.stdout, /PASS repository verification/);
});
