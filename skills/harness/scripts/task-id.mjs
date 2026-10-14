#!/usr/bin/env node
import assert from "node:assert/strict";
import { link, mkdir, open, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTask, validateTaskGraph } from "./task-ready.mjs";

async function scanTaskFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && /^task-.+\.md$/.test(entry.name)) {
      files.push({ file: entry.name, path: join(directory, entry.name) });
    }
  }
  const archiveDir = join(directory, "archive");
  try {
    const archiveEntries = await readdir(archiveDir, { withFileTypes: true });
    for (const entry of archiveEntries) {
      if (entry.isFile() && /^task-.+\.md$/.test(entry.name)) {
        files.push({ file: join("archive", entry.name), path: join(archiveDir, entry.name) });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function loadTasks(directory, { validate = true, includeArchive = false } = {}) {
  let fileList;
  if (includeArchive) {
    fileList = await scanTaskFiles(directory);
  } else {
    const names = (await readdir(directory)).filter((file) => /^task-.+\.md$/.test(file)).sort();
    fileList = names.map((file) => ({ file, path: join(directory, file) }));
  }
  const records = await Promise.all(fileList.map(async ({ file, path }) => {
    const text = await readFile(path, "utf8");
    return { text, task: parseTask(file, text) };
  }));
  if (validate) {
    validateTaskGraph(records.map(({ task }) => task));
  }
  return records;
}

export async function resolveTask(directory, reference) {
  const ref = typeof reference === "number" || /^[1-9]\d*$/.test(String(reference).trim())
    ? `#${String(reference).trim()}`
    : String(reference).trim();
  const records = await loadTasks(directory, { validate: false, includeArchive: true });
  const matches = records.filter(({ task }) =>
    task.ref === ref || task.id === ref || task.file === ref ||
    task.file === `${ref}.md` || task.file === join("archive", ref) ||
    task.file === join("archive", `${ref}.md`));
  assert.equal(matches.length, 1, `Expected one task for ${reference}; found ${matches.length}`);
  return matches[0].task;
}

export async function allocateTasks(directory, create = null) {
  await mkdir(directory, { recursive: true });
  const lock = join(directory, ".task-ids.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Task ID allocator locked: ${lock}; retry after the other writer finishes`);
    throw error;
  }
  try {
    const records = await loadTasks(directory);
    const counter = join(directory, ".task-ids.json");
    let nextId = 1;
    try {
      const state = JSON.parse(await readFile(counter, "utf8"));
      assert(Number.isSafeInteger(state.nextId) && state.nextId > 0, "Invalid task ID counter");
      nextId = state.nextId;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      assert(!records.some(({ task }) => task.number !== null),
        "Task ID counter missing for numbered tasks; restore .task-ids.json from version control");
    }
    for (const { task } of records) nextId = Math.max(nextId, (task.number || 0) + 1);
    const missing = records.filter(({ task }) => task.number === null);
    if (create) {
      assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(create.slug), "Slug must be lowercase words separated by hyphens");
      assert(typeof create.title === "string" && create.title.trim() && !/[\r\n]/.test(create.title), "Title must be one non-empty line");
      assert(typeof create.owner === "string" && create.owner.trim() && !/[\r\n]/.test(create.owner), "Owner must be one non-empty line");
      assert.equal(missing.length, 0, "Run assign before creating tasks in a legacy directory");
      const file = `task-${create.slug}.md`;
      assert(!records.some(({ task }) => task.file === file), `Task already exists: ${file}`);
      const template = await readFile(new URL("../templates/task-template.md", import.meta.url), "utf8");
      const values = {
        TASK_ID: `task-${create.slug}`, TASK_NUMBER: String(nextId),
        TASK_TITLE: create.title.trim(), TASK_OWNER: create.owner.trim(),
      };
      const text = template.replace(/\{\{(TASK_ID|TASK_NUMBER|TASK_TITLE|TASK_OWNER)\}\}/g,
        (_, key) => values[key]).replace(/\n<!-- harness .* -->\n?$/, "\n");
      missing.push({ text, task: parseTask(file, text), create: true });
    }
    const end = nextId + missing.length;
    assert(Number.isSafeInteger(end), "Task ID space exhausted");
    // Reserve first: a failed write may leave gaps, but must never reuse an ID.
    await writeFile(`${counter}.tmp`, JSON.stringify({ nextId: end }, null, 2) + "\n");
    await rename(`${counter}.tmp`, counter);
    const assigned = [];
    for (const record of missing) {
      const { task } = record;
      const number = nextId++;
      const text = record.create ? record.text : record.text.replace(/^(# .+\r?\n)/m, `$1\n- ID: ${number}\n`);
      const updated = parseTask(task.file, text);
      assert.equal(updated.number, number, `${task.file}: failed to insert reserved ID`);
      const path = join(directory, task.file);
      if (record.create) {
        const temp = `${path}.tmp`;
        const handle = await open(temp, "wx");
        try {
          await handle.writeFile(text);
          await handle.close();
          // Publish a complete file without overwriting an existing destination.
          await link(temp, path);
        } finally {
          await handle.close();
          await rm(temp, { force: true });
        }
      } else {
        assert.equal(await readFile(path, "utf8"), record.text, `${task.file}: changed during ID assignment; retry`);
        await writeFile(`${path}.tmp`, text);
        await rename(`${path}.tmp`, path);
      }
      assigned.push(updated);
    }
    return assigned;
  } finally {
    await rmdir(lock);
  }
}

async function main() {
  const [command, directory, ...args] = process.argv.slice(2);
  assert(directory && ["assign", "create", "resolve"].includes(command),
    'Usage: task-id.mjs assign <tasks-dir> | create <tasks-dir> <slug> "<title>" "<owner>" | resolve <tasks-dir> "#42"');
  const dir = resolve(directory);
  if (command === "resolve") {
    assert.equal(args.length, 1, "resolve requires a task ID, slug, or filename");
    process.stdout.write(JSON.stringify(await resolveTask(dir, args[0]), null, 2) + "\n");
  } else {
    assert.equal(args.length, command === "create" ? 3 : 0, "Invalid allocation arguments");
    const assigned = await allocateTasks(dir, command === "create" ? { slug: args[0], title: args[1], owner: args[2] } : null);
    for (const task of assigned) process.stdout.write(`${task.ref} - ${task.title} (${task.file})\n`);
    if (!assigned.length) process.stdout.write("All task IDs already assigned.\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
