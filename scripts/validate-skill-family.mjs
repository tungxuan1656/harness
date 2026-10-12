#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const skills = [
  {
    name: "harness",
    files: [
      "PROVENANCE.md",
      "metadata.json",
      "agents/openai.yaml",
      "templates/agents.md",
      "CHANGELOG.md",
      "evals/evals.json",
      "references/migration-v2.md",
      "templates/task-template.md",
      "templates/task-index.md",
      "templates/init.sh",
    ],
    agent: true,
    metadata: true,
    evals: true,
  },
  {
    name: "harness-task",
    files: [
      "agents/openai.yaml",
      "references/task-routing-matrix.md",
      "evals/evals.json",
    ],
    agent: true,
    evals: true,
    implicit: true,
  },
  {
    name: "harness-review",
    files: ["agents/openai.yaml", "references/review-rubric.md"],
    agent: true,
  },
  {
    name: "repo-gardening",
    files: ["agents/openai.yaml", "references/cleanup-rubric.md"],
    agent: true,
  },
  {
    name: "agent-docs-writer",
    files: [
      "references/decision-document.md",
      "references/entry-documents.md",
      "references/information-patterns.md",
      "references/review-checklist.md",
      "references/system-documents.md",
      "references/work-documents.md",
    ],
  },
  {
    name: "agent-docs-architect",
    files: [
      "agents/openai.yaml",
      "evals/evals.json",
      "references/artifact-catalog.md",
      "references/blueprint-format.md",
      "references/scale-profiles.md",
    ],
    agent: true,
    evals: true,
  },
];

skills.push(
  { name: "agent-docs-checker", files: ["agents/openai.yaml", "evals/evals.json"], agent: true, evals: true },
  ...["writing-plans", "executing-plans", "handoff", "brainstorming"].map((name) => ({ name, files: [] })),
  { name: "subagent-driven-development", files: ["scripts/task-brief", "scripts/sdd-workspace", "scripts/review-package"] },
);

const removedSkills = [
  "harness-slim",
  "harness-slim-review",
  "harness-router",
  "harness-map",
  "harness-specs",
  "harness-features",
  "harness-verify",
  "harness-garden",
  "harness-docs-guide",
  "harness-slim-gardenring",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readRequired(path) {
  assert(await exists(path), `Missing required file: ${path}`);
  return readFile(path, "utf8");
}

function validateFrontmatter(source, path, expectedName) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${path}: missing YAML frontmatter`);

  const fields = [...match[1].matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)].map(
    ([, field]) => field,
  );
  assert(
    fields.length === 2 && fields.includes("name") && fields.includes("description"),
    `${path}: frontmatter must contain only name and description`,
  );
  assert(
    new RegExp(`^name:[ \\t]*${expectedName}[ \\t]*$`, "m").test(match[1]),
    `${path}: frontmatter name must be ${expectedName}`,
  );
  assert(
    /^description:[ \t]*(?:[>|][+-]?[ \t]*|[^ \t\r\n].*)$/m.test(match[1]),
    `${path}: description must not be empty`,
  );
}

function validateAgent(source, path) {
  for (const field of ["display_name", "short_description", "default_prompt"]) {
    assert(
      new RegExp(`^[ \\t]{2}${field}:[ \\t]*.+$`, "m").test(source),
      `${path}: missing ${field}`,
    );
  }
}

function validateEvals(source, path, expectedName) {
  const corpus = JSON.parse(source);
  assert(corpus.skill_name === expectedName, `${path}: skill_name mismatch`);
  assert(Array.isArray(corpus.evals) && corpus.evals.length > 0, `${path}: no evals`);

  const ids = new Set();
  for (const evaluation of corpus.evals) {
    assert(Number.isInteger(evaluation.id), `${path}: eval id must be an integer`);
    assert(!ids.has(evaluation.id), `${path}: duplicate eval id ${evaluation.id}`);
    ids.add(evaluation.id);
    for (const field of ["name", "prompt", "expected_output"]) {
      assert(
        typeof evaluation[field] === "string" && evaluation[field].trim(),
        `${path}: eval ${evaluation.id} missing ${field}`,
      );
    }
    for (const field of ["files", "expectations", "tags"]) {
      assert(Array.isArray(evaluation[field]), `${path}: eval ${evaluation.id} ${field} must be an array`);
      assert(
        evaluation[field].every((value) => typeof value === "string" && value.trim()),
        `${path}: eval ${evaluation.id} ${field} must contain non-empty strings`,
      );
    }
    assert(evaluation.expectations.length > 0, `${path}: eval ${evaluation.id} has no expectations`);
  }
}

async function validateHarnessContract(directory) {
  const metadataPath = resolve(directory, "metadata.json");
  const metadata = JSON.parse(await readRequired(metadataPath));
  assert(metadata.version === "2.0.0", `${metadataPath}: expected v2 contract`);
  for (const path of [...metadata.references, ...metadata.bundled.templates, ...metadata.bundled.scripts]) {
    await readRequired(resolve(directory, path));
  }
  for (const name of ["feature_index.json", "feat-template.md", "progress.md"]) {
    assert(!(await exists(resolve(directory, "templates", name))), `Legacy template remains packaged: ${name}`);
  }
  const taskPath = resolve(directory, "templates/task-template.md");
  const task = await readRequired(taskPath);
  for (const field of ["Status", "Owner", "Required to start", "Required to integrate/release"]) {
    assert(task.includes(`- ${field}:`), `${taskPath}: missing ${field}`);
  }
  const indexPath = resolve(directory, "templates/task-index.md");
  const index = await readRequired(indexPath);
  assert(!/^- (Status|Owner|Depends on):|\|\s*(Status|Owner|Depends on)\s*\|/mi.test(index), `${indexPath}: must not mirror task state`);
  const agentsPath = resolve(directory, "templates/agents.md");
  assert(!(await readRequired(agentsPath)).includes(".agents/README.md"), `${agentsPath}: invalid router path`);
}

async function validateMarkdownLinks(path) {
  const source = (await readRequired(path)).replace(/^```[^\n]*\n[\s\S]*?^```.*$/gm, "");
  for (const [, target] of source.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)|[<>{}]/i.test(target)) continue;
    const destination = decodeURIComponent(target.split("#")[0]);
    assert(await exists(resolve(dirname(path), destination)), `${path}: broken local link ${target}`);
  }
}

async function validateMarkdownTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await validateMarkdownTree(path);
    else if (entry.name.endsWith(".md")) await validateMarkdownLinks(path);
  }
}

async function validateSkill(skill) {
  const directory = resolve(repositoryRoot, "skills", skill.name);
  const skillPath = resolve(directory, "SKILL.md");
  const source = await readRequired(skillPath);
  validateFrontmatter(source, skillPath, skill.name);

  for (const file of skill.files) {
    await readRequired(resolve(directory, file));
  }

  if (skill.agent) {
    const agentPath = resolve(directory, "agents/openai.yaml");
    const agentSource = await readRequired(agentPath);
    validateAgent(agentSource, agentPath);
    if (skill.implicit) {
      assert(
        /^[ \t]{2}allow_implicit_invocation:[ \t]*true[ \t]*$/m.test(agentSource),
        `${agentPath}: implicit invocation must be enabled`,
      );
    }
  }

  if (skill.metadata) {
    const metadataPath = resolve(directory, "metadata.json");
    const metadata = JSON.parse(await readRequired(metadataPath));
    assert(metadata.name === skill.name, `${metadataPath}: name mismatch`);
  }

  if (skill.name === "harness") {
    await validateHarnessContract(directory);
  }

  await validateMarkdownTree(directory);

  if (skill.evals) {
    const evalPath = resolve(directory, "evals/evals.json");
    validateEvals(await readRequired(evalPath), evalPath, skill.name);
  }

  process.stdout.write(`PASS ${skill.name}\n`);
}

async function main() {
  for (const skill of skills) {
    await validateSkill(skill);
  }

  for (const skillName of removedSkills) {
    const path = resolve(repositoryRoot, "skills", skillName);
    assert(!(await exists(path)), `Removed skill remains packaged: ${path}`);
  }

  await validateMarkdownLinks(resolve(repositoryRoot, "README.md"));
  process.stdout.write("PASS skill family layout and local routes\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
