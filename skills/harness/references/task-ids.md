# Local Task IDs

Every local task has a project-local positive integer in its header (`- ID: 42`).
Refer to it as `#42`; keep the descriptive heading and `task-<slug>.md` filename
for compatibility. The number is identity, not list position, status, or priority.
Never edit, renumber, or reuse it, including after rename, completion, archive,
or deletion. Use an accessible external tracker's own ID when it is canonical;
do not allocate a second local identity for that issue.

## Create and reference

Use the installed harness script (replace `<harness-path>` with its actual path):

```bash
node <harness-path>/scripts/task-id.mjs create tasks/ export-csv "Export CSV" "alice"
node <harness-path>/scripts/task-id.mjs resolve tasks/ '#42'
node <harness-path>/scripts/task-ready.mjs tasks/
```

`create` writes the bundled task template and prints its allocated ID and path.
Fill its scope, acceptance, sources, plan, and verification before implementation;
a generated stub is not approval or evidence of readiness. `resolve` is read-only
and returns the task's metadata and filename as JSON. It also accepts old heading
IDs, slugs (`task-export-csv`), and filenames. Quote `'#42'` in shells: an unquoted
`#` starts a comment. Read the resolved file and linked sources, check actual
blockers and approval, then update only that task's status/evidence/handoff.

Use `#42 - Export CSV` in ready lists, implementation reports, plans, delegation,
and handoffs. Include the filename when someone needs to open it. Do not repeat
long slugs in conversational task lists. A plan's `Task 1` step numbering is
local to that plan, not a project task ID. Across projects qualify with project
name, e.g. `my-app#42`; resolution is always against an explicit tasks directory.

Dependencies can use `#42 and #43` or clickable links such as
`[#42 - Title](task-<slug>.md)`. Existing file links remain valid.
Keep start gates separate from integrate/release gates; `task-ready` evaluates
only start gates, not release permission. Unknown/self/cyclic start references
and duplicate IDs fail validation. Keep manual conditions explicit.

## Upgrade existing tasks

With approval, first reconcile invalid task headers or dependency graphs, then:

```bash
node <harness-path>/scripts/task-id.mjs assign tasks/
node <harness-path>/scripts/task-ready.mjs tasks/ --all
```

`assign` allocates numbers to unnumbered `task-*.md` files in sorted filename
order. Re-running preserves existing numbers. It leaves headings, filenames,
status, ownership, links, and history intact. Add IDs to roadmap link labels
when updating navigation; no wholesale link rewrite is needed. Include retained
archived tasks in the approved migration inventory before allocating new work;
the script scans only the given directory, not arbitrary archive trees.
Legacy tasks remain readable by `task-ready`, using their old heading ID until
explicitly migrated. JSON keeps legacy `id` and adds `number` and `ref`.

## Allocation and concurrency

Commit `tasks/.task-ids.json` with the tasks: its `nextId` high-water mark prevents
reuse even when the highest numbered task is removed. Do not reset, delete, or
ignore this file. If missing from a numbered project, restore it from version
control; do not reconstruct it from only surviving tasks. All local tasks in
one project must use the same canonical directory and allocator.

Allocation reserves numbers before writing tasks; failure can leave gaps, which
are intentional. A directory lock serializes writers in the same checkout.
A busy allocator fails with a retry instruction. Never remove a live lock.
After a confirmed crashed process, inspect partial files/counter and remove only
the stale `.task-ids.lock` directory before retrying. Do not commit lock or temp
files. Task IDs do not reserve source files or authorize backlog work.

Separate clones/worktrees do not share this lock. Allocate tasks in the canonical
checkout before parallel implementation and share those records. If branches
independently create colliding IDs, stop integration and reconcile IDs and all
references explicitly with the coordinator; never auto-renumber established
IDs. Use a central external tracker when distributed allocation is required.
