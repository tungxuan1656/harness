# Harness v2

A small skill family for practical coding-agent work. Canonical specs, plans,
decisions, design docs, and architecture carry the knowledge. The harness
only routes to it, keeps task-local restart state, and verifies changes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Skills

| Skill | Use when | Result |
|---|---|---|
| `harness` | Create or simplify a repository harness | Short `AGENTS.md`, justified task artifacts, minimal `init.sh` |
| `harness-task` | Size work or decompose an approved spec | No record, inline task plan, or justified separate plan |
| `harness-review` | Assess the operating harness | Read-only findings and smallest repairs |
| `agent-docs-architect` | Documentation ownership or routes are unclear | Minimal blueprint, existing sources reused |
| `agent-docs-writer` | Write or repair a selected document | Concise, evidence-based canonical content |
| `agent-docs-checker` | Check docs drift, consistency, or unnecessary complexity | Read-only, scoped findings against code, tests, and accepted intent |
| `repo-gardening` | Remove confirmed code/config/artifact residue | Small, separately verified cleanup |

Use the narrowest skill, not a mandatory pipeline. Simplicity assessment lives
in the docs checker and planning self-checks; no separate mandatory gate.
`harness-task` chooses artifacts, not agents or orchestration.

## Work contracts

```text
AGENTS.md                     # router and repository-specific invariants
init.sh                       # minimal verification entrypoint
tasks/index.md                # requested roadmap/navigation, not status
tasks/task-<slug>.md           # only work that needs persistent state
docs/plans/task-<slug>.md      # only when separate sequencing is justified
```

- Small, clear, reversible work and read-only requests need no task file.
- A task/tracker owns scope, acceptance, owner, dependencies, status, evidence,
  blockers, and next action. No root `progress.md` or mirrored tracker state.
- Keep the requested index for roadmap and links; update it for membership or
  scope changes, not every execution update. Dependencies remain in tasks/tracker.
- Independent tasks can be active concurrently. Descriptive or tracker IDs
  replace global counters; coordinate overlapping source changes separately.
- Distinguish dependencies needed to start from integration/release gates.
  Split specs into verifiable deliverables; use epics/subtasks only when useful.
- Plans stay inline by default. A separate plan needs durable sequencing,
  coordination, recovery, or risk controls, not a file-count threshold.

Reuse adequate native filenames and accessible trackers. Keep durable behavior
and rationale in specs, decisions, architecture, and tests, not task history.
At closure extract that knowledge, check inbound links/dependents and retention
policy, then retain, selectively archive, or remove disposable tasks.
Cross-person handoffs need an accessible tracker, PR, branch, or commit, not
a local temporary file; disclose uncommitted work.

## Verification

`init.sh` uses Bash strict mode, script-directory resolution, and a sequential
`run_check` wrapper that preserves failures. Use the observed read-only root
check (for example `pnpm run check`) when it already owns coverage/concurrency.
Do not fix source, install dependencies, swallow errors, invent scripts, or
add a Bash job scheduler. Build/cache/test outputs can still be written.

The distributed template explicitly skips unconfigured project checks and
reports only configured checks, not full verification. Replace that gap with
actual commands before claiming repository coverage. Do not run it on every
startup merely to inspect docs.

## Optional companions

| Need | Skills |
|---|---|
| Resolve behavior or design choices | `brainstorming`, `codebase-design` |
| Plan and execute approved work | `writing-plans`, `executing-plans` |
| Authorized delegated implementation | `subagent-driven-development` |
| Debug and verify completion | `systematic-debugging`, `verification-before-completion` |
| Transfer or communicate work | `handoff`, `simple-english`, `git-commit` |
| Find additional capabilities | `find-skills` |

Planning and execution remain separate skills; neither needs duplicated future
code, tiny mandatory steps, or a commit ritual. Reuse the repository artifact
owner/path; do not create a fallback `docs/superpowers/` tree. Optional agent
scratch/review packages are not canonical task state or a cross-person handoff.

## Install and migrate

The upstream repository URL stays unchanged; v2 skill names change.

```bash
npx skills add tungxuan1656/harness-slim --skill harness
npx skills add tungxuan1656/harness-slim --skill harness-task
npx skills add tungxuan1656/harness-slim --skill harness-review
npx skills add tungxuan1656/harness-slim --skill agent-docs-checker
```

Select other skills by name only when needed. `harness-slim` and
`harness-slim-review` installations/invocations must be updated explicitly.
Managed v1 repositories do not migrate automatically. See the
[migration guide](skills/harness/references/migration-v2.md) and
[changelog](skills/harness/CHANGELOG.md). Preserve legacy history and resolve
contradictory owners/state before switching live routes.

```text
Use $harness to simplify our harness using observed repository commands.
Use $harness-task to decompose this approved spec into independent tasks.
Use $agent-docs-checker to check this spec and plan for drift and unnecessary work.
Use $agent-docs-writer to apply these agreed documentation repairs.
```

## Development checks

```bash
node scripts/validate-skill-family.mjs
node --test scripts/test-*.mjs
bash -n skills/harness/templates/init.sh
git diff --check
```

The validator checks package resources, metadata, local Markdown routes, and
eval-corpus shape. Shell tests exercise actual success/failure, check coverage
boundaries, staged/unstaged whitespace, and execution from another directory.
Eval scenarios are regression inputs, not proof that model behavior passed.
Representative repository trials remain necessary for behavioral claims.

## References

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [OpenAI: Harness Engineering](https://openai.com/index/harness-engineering/)

Inspired in part by [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering).

[MIT](LICENSE)
