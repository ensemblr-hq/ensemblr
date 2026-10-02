# Filesystem Safety, Git & Process Execution, Deletion Scope, Open Targets

Audit of `src/main/{workspace-files,repository,root,commands,open-target,checkpoints,workspace-git,linked-directories}`, `src/main/github/github-service.ts`, and the shared path/ref helpers, against the `SECURITY.md` threat model.

The git and process-spawn layer is in good shape: nothing uses `shell: true`, every `git`/`gh`/`du`/`open` argument list is built as an argv array from either a constant or a value-position operand, `--` separates options from positionals everywhere a repo-relative path is passed, `validate-git-ref.ts` is applied at every point a ref can enter from a repository's own `.ensemblr/settings.toml`, and the app's own git invocations run with the login-shell environment rather than any repository-supplied environment layer. Deletion is the strongest area: `delete-repository.ts` and `sweep-workspace-disk.ts` canonicalize both sides through `realpath` before any recursive removal and refuse anything that is not exactly the expected depth inside the managed root.

The gap is symlinks in the `.context` handoff directory. `.context` is checked out from the repository like any other path, and two of the four writers that target it resolve their path lexically and then write through whatever the filesystem hands them. Both escapes are confirmed end-to-end against real `git` and real `fs`. The codebase already contains the correct pattern twice (`plan-file-writer.ts`, `context-attachments.ts:prepareContextSubdir`), so these are omissions rather than a missing design.

Two performance findings: `git status --untracked-files=all` is polled per workspace on a 30 s dashboard timer plus 10 s for the focused workspace, and the checkpoint layer runs `git add -A` plus three full `git diff` passes per agent turn with no timeout and a 16 MB buffer.

## Findings

### [FS-01] A repository committing `.context` as a symlink redirects every `ensureContextPath` write out of the worktree

- Severity: **High**
- Confidence: **Confirmed**
- Where: `src/main/config/context-directory.ts:52` (writers: `src/main/scripts/setup-state-file.ts:73`, `src/main/terminal/terminal-output-file.ts:54`)

```ts
export function ensureContextPath(
	worktreePath: string,
	...segments: string[]
): string | null {
	if (!existsSync(worktreePath)) {
		return null;
	}

	const contextPath = resolveContextPath(worktreePath, ...segments);
	mkdirSync(dirname(contextPath), { recursive: true });

	return contextPath;
}
```

**What.** `resolveContextPath` composes the path with `new URL(...)`, which is purely lexical — it never consults the filesystem — and `ensureContextPath` then `mkdir -p`s the parent and hands the path back. Neither call checks that the result still resolves inside `worktreePath`. `.git/info/exclude` gains a `.context/` entry at workspace creation (`create-workspace.ts:1190`), but an *ignore* rule has no effect on a **tracked** path: git checks `.context` out regardless.

**Scenario.** A repository commits `.context` as a relative symlink, e.g. `.context -> ../../../../.ssh` (from `<root>/workspaces/<repo>/<ws>/` that is the user's home). The user opens the repo and creates a workspace; `git worktree add` materializes the symlink. Then:

- `writeSetupStateFile` writes `setup.local.json` through it,
- `writeTerminalOutput` writes `terminals/<uuid>.log` — **raw terminal scrollback, ANSI included, which the module's own JSDoc notes "may echo secrets"** — through it.

Verified with real `git` and Node: a repo committing `.context -> ../victim` checks the symlink out into the worktree, and `mkdirSync(dirname(p), {recursive:true}) + writeFileSync(p, …)` lands at `<victim>/terminals/x.log`. The final filename is a UUID or a fixed marker name, so the attacker picks the *directory*, not the leaf — the impact is out-of-tree file creation plus scrollback disclosure to a location of the repository author's choosing, not a targeted overwrite. See [FS-02] for the targeted-overwrite variant.

**Existing guards & tests checked.** None on this path. `mkdirSync(…, {recursive: true})` succeeds straight through a symlinked directory. The correct pattern exists twice in-tree: `src/main/plan-mode/plan-file-writer.ts:134` walks each level and re-checks `isInside(realpath(root), realpath(level))`, and `src/main/workspace-files/context-attachments.ts:394` (`prepareContextSubdir`) calls `isWithinWorkspaceReal` after each `mkdir`. `tests/main/plan-mode-plan-file-writer.test.ts` covers the plan writer; nothing covers `ensureContextPath`.

**Fix.** Give `ensureContextPath` the same per-level realpath walk `prepareContextSubdir` performs, returning `null` on the first level that resolves outside the worktree. Because every `.context` writer is required to route through it ("Every writer that persists into `.context` must go through this rather than resolving and creating the path itself" — its own JSDoc), one change covers all of them, and both call sites already handle a `null` return. Belt-and-braces: open the leaf with `O_NOFOLLOW` (`flag: 'wx'` plus an explicit `lstat`, or `fs.open` with `O_NOFOLLOW|O_CREAT|O_TRUNC`).

### [FS-02] The action-prompt writer follows a committed symlink at its leaf, giving a repository an arbitrary-path write with substantially attacker-chosen content

- Severity: **High**
- Confidence: **Confirmed** (write primitive); **Likely** (content control)
- Where: `src/main/workspace-files/context-attachments.ts:183`

```ts
const target = resolveWorkspacePath({
    pathValue: relativePath,          // `.context/attachments/ensemblr-<stem>.md`
    workspaceCwd: cwdResult.cwd,
});
if (!target.ok) {
    return { error: { code: 'invalid-path', message: target.message } };
}
await writeFile(target.absolutePath, request.content, { flag: 'w' });
```

**What.** `prepareContextSubdir` (line 394) validates `.context` and `.context/attachments` after each `mkdir`, so the *directories* are contained. The **leaf** is not: `resolveWorkspacePath` is lexical by design (its own JSDoc says reads must realpath both sides), and `writeFile` with `flag: 'w'` opens `O_WRONLY|O_CREAT|O_TRUNC`, which follows a symlink at the final component.

**Scenario.** A repository commits `.context/attachments/` as real directories holding one symlink, `ensemblr-review.md -> ../../../../../../.zshenv`. `stem` comes from `request.action` through `sanitizeAttachmentStem`, and the action names are fixed app strings (`review`, and the rest of `ACTION_TRIGGER_MESSAGE`), so the filename is fully predictable. The user clicks a review action; `writeContextActionPrompt` truncates and rewrites the symlink target.

Verified end-to-end: the committed symlink survives `git worktree add`, `prepareContextSubdir` passes (both directories are genuine), and `writeFileSync(…, {flag:'w'})` replaced the link target's contents.

The content is the composed action prompt, which embeds `prDescription` and `prTitle` resolved from `gh pr view --json` (`use-agent-action-runner.ts:145` → `action-prompts.ts:233`). A PR body on the repository is therefore partly under the attacker's control, which is what turns "overwrite a dotfile with markdown" into "write attacker-chosen lines into `~/.zshenv`". That second step is why this outranks [FS-01]; it is rated Likely rather than Confirmed because I did not trace every transform `composeActionPrompt` applies to the PR body.

**Existing guards & tests checked.** `prepareContextSubdir` (directories only). `sanitizeAttachmentStem` (line 489) restricts the stem to `[a-z0-9_-]`, which blocks stem-driven traversal but is irrelevant here — the traversal is in the filesystem, not the string. The sibling write path in the same file is safe by construction and worth preserving as the model: `attemptPlacement` (line 288) stages with `flag: 'wx'` (`O_EXCL`, which refuses a symlink) and publishes with `link()`, which fails `EEXIST` on an existing link rather than writing through it.

**Fix.** `lstat` the target before writing and refuse when it is a symlink, or open with `O_NOFOLLOW`. The content-addressed path's write-then-`link` dance is the stronger pattern if this path can tolerate it.

### [FS-03] Four recursive-removal call sites skip the `containmentRefusal` guard the other three apply

- Severity: **Medium**
- Confidence: **Confirmed**
- Where: `src/main/repository/worktree-placement.ts:117`, `src/main/repository/git-ops.ts:885`, `src/main/repository/rehydrate-worktree.ts:78`, `src/main/repository/delete-archived-workspace.ts:260`

```ts
// rehydrate-worktree.ts:78
await removeDirectoryTree(workspacePath);

// delete-archived-workspace.ts:260
const outcome = await removeDirectoryTree(preservedPath);
```

**What.** `removeDirectoryTree` (`remove-directory.ts:26`) is an unguarded `fs.rm({recursive: true, force: true})`. Three of its seven callers wrap it in `containmentRefusal` — `delete-repository.ts:489`, `delete-repository.ts:531`, `sweep-workspace-disk.ts:304` — which canonicalizes both sides through `realpathSync.native` and asserts an exact depth under the managed root. The four above pass a path straight from a SQLite row (`workspaces.path`, `archived_context_path`) with no containment assertion at all.

**Scenario.** A `workspaces` row whose `path` points outside the managed root reaches `rehydrate-worktree.ts:78` on unarchive, or `delete-archived-workspace.ts:260` on archive deletion, and the tree at that path is removed. Reaching such a row is not trivial: `create-workspace.ts` computes the path from `workspacesPath + repository.slug + slug`, and adoption (`adopt-shared-root/scan.ts:41`) only admits directories `statSync` reports under the root the user pointed at. But `readChildDirectories` uses `statSync`, not `lstatSync`, so a symlink under `workspaces/<repo>/` *is* adopted with the symlink's own path recorded on the row. In practice `fs.rm` on a symlink unlinks the link rather than descending (Node lstats first), which contains the blast radius today — but that containment is incidental to `fs.rm`'s semantics, not stated anywhere, and the depth invariant the other three callers enforce is genuinely absent.

**Existing guards & tests checked.** `containmentRefusal` and `classifyManagedChild` are correct and well-tested (`tests/main/sweep-workspace-disk.test.ts`, `tests/main/delete-repository.test.ts`) — including the empty-segment case that would collapse an empty slug to the root itself. `toSlug` always has a non-empty fallback at every repository/workspace call site (`register-repository.ts:411`, `create-workspace.ts:1117`, `rename-workspace.ts:678`), so the empty-slug path is closed twice over. This finding is only about the four unguarded callers.

**Fix.** Route all seven through one guarded helper — `removeManagedDirectory({ path, root, expectedDepth })` — so containment is not something a new call site can forget. `delete-repository.ts:680` (`removeArchivedContextsForRepository`) is safe only because its path is `archivedContextsPath + <slug>`; it should use the same helper for consistency.

### [FS-04] `git status --untracked-files=all` is polled for every workspace on a 30 s timer

- Severity: **Medium** (performance)
- Confidence: **Confirmed**
- Where: `src/renderer/hooks/workbench-shell/route-layout/use-workbench-queries.ts:111`, `src/renderer/api/ensemblr/workspace-git.ts:16`, `src/main/workspace-git/workspace-git-status.ts:296`

```ts
const projects = useQueries({
    combine: combineWorkspaceChangeSummaries,
    queries: workspaceChangeSummaryTargets.map((target) => ({
        ...workspaceGitStatusQuery(target.workspaceCwd, target.scope),
        enabled: hasPreloadBridge && target.workspaceCwd.length > 0,
        refetchInterval: OVERVIEW_GIT_STATUS_REFETCH_INTERVAL_MS,   // 30_000
    })),
});
```

**What.** The dashboard issues one `git status --porcelain -z --untracked-files=all` per workspace every 30 s, and the focused workspace adds its own every 10 s (`GIT_STATUS_REFETCH_INTERVAL_MS = 10_000`). `-uall` is deliberate and correct — git's default collapses a new directory to a single `dir/` entry — but it also means git walks every untracked file rather than stopping at the first entry in a directory.

**Scenario.** Twenty registered workspaces on dependency-heavy repos: twenty `git status` processes every 30 s, each `lstat`-ing its whole untracked set. On a worktree where a large build or vendor directory is untracked-but-not-ignored the walk is seconds long, and the processes overlap. The effect is sustained background CPU and page-cache churn rather than a hang, but it scales linearly with workspace count and never backs off when the window is idle.

**Existing guards & tests checked.** `MAX_OUTPUT_BYTES` and `TIMEOUT_MS` are applied per invocation (`workspace-git-status.ts:114`). `core.untrackedCache` is never enabled on managed clones; nothing pauses polling on window blur.

**Fix.** Three independent levers, cheapest first: pause the overview queries when the window is not focused; drive invalidation from the existing `watch-workspace-files` watcher (already debounced at 250 ms with a 1 s max-wait) and let the timer be a slow backstop; and set `core.untrackedCache=true` plus `core.fsmonitor` on managed clones at clone time, which is what `-uall` costs the most without.

### [FS-05] `copyOneFile` writes through a symlinked destination when seeding a new worktree

- Severity: **Medium**
- Confidence: **Confirmed** (primitive); **Speculative** (reachability)
- Where: `src/main/repository/files-to-copy.ts:220`

```ts
export function copyOneFile(from: string, to: string): CopyOneOutcome {
	if (!existsSync(from)) {
		return { status: 'missing' };
	}
	if (!lstatSync(from).isFile()) {
		return { status: 'not-a-file' };
	}
	try {
		mkdirSync(path.dirname(to), { recursive: true });
		copyFileSync(from, to);
```

**What.** The **source** is correctly `lstat`ed and refused when it is not a regular file. The **destination** is not checked at all, and `copyFileSync` follows a symlink at `to`.

**Scenario.** Workspace creation copies the repository checkout's untracked-and-ignored matches (default pattern `.env*`) into the fresh worktree. If the branch being checked out tracks `.env` as a symlink — say `.env -> ../../../../.zshenv` — `git worktree add` materializes it, then `copyOneFile` copies the base checkout's real `.env` through it. The content written is the *user's own* `.env`, not the attacker's, which is why this is Medium rather than High: it is a targeted overwrite with non-attacker-chosen bytes. Reachability is marked Speculative because it needs the path to be untracked in the base checkout and tracked-as-a-symlink on the workspace's branch — possible when the two are on different branches, but not the common case.

**Existing guards & tests checked.** The pattern list itself is safe: repository-supplied patterns (`.worktreeinclude`, `.ensemblr/settings.toml`) are written to a `mkdtemp` scratch file and passed as `--exclude-from=<app-generated path>` (line 177), never interpolated into an argument, and `git ls-files --others` cannot emit a path containing `..`. `tests/main/copy-directory.test.ts` covers `copyDirectoryTree`, not `copyOneFile`.

**Fix.** `lstat` the destination and refuse when it exists and is a symlink, matching the check already applied to the source one line up.

### [FS-06] `parseGithubUrl` accepts an owner or repository name beginning with `-`

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/repository/github-url.ts:19`

```ts
const GITHUB_URL_PATTERN =
	/^https?:\/\/(?:[^/@\s]*@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
const SSH_URL_PATTERN = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
const SHORTHAND_URL_PATTERN = /^(?:gh:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i;
```

**What.** `-` is inside the character class and unanchored against the leading position, so `-x/repo` parses with `owner = "-x"`. `validatedUrl` is then `-x/repo`, and `clone-runner.ts:142` passes it as the first positional to `gh repo clone` with no `--` before it:

```ts
args: ['repo', 'clone', preparation.validatedUrl, preparation.targetPath, '--', …]
```

**Scenario.** A user pastes `-R/x` (or a link crafted to look like one). Cobra reads `-R` as a flag bundle; `gh repo clone` exposes only `-u/--upstream-remote-name`, which consumes the next token as a value, so the outcome is a confusing error rather than an exploit. The `git` fallback leg is unaffected: it uses `sanitizedUrl`, which is always re-composed as `https://github.com/…`. An `owner` or `repositoryName` of `..` also parses; `allocateUniqueTargetPath` resolves `path.resolve(parent, '..')`, finds it exists, and falls through to the `..-2` suffix loop, which stays inside the parent — contained, but by accident.

**Existing guards & tests checked.** The patterns are fully anchored and reject `ext::`, `file://`, and any non-`github.com` host, which is the important half. No `--recurse-submodules` anywhere in `src/` (grep confirms zero hits), so a repository's `.gitmodules` is never acted on during clone.

**Fix.** Anchor the first character: `[\w.][\w.-]*`. Separately, add `--` before `preparation.validatedUrl` in the `gh` argv so positional/option confusion is structurally impossible.

### [FS-07] Every workspace-scoped IPC accepts an arbitrary absolute path as its workspace root

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/workspace-files/workspace-cwd.ts:13`, `src/main/github/github-service.ts:777`, `src/main/commands/command-request.ts:165`

```ts
export function resolveWorkspaceCwd(workspaceCwd: string): ResolvedWorkspaceCwd {
	const cwd = workspaceCwd?.trim();
	if (!cwd || !path.isAbsolute(cwd)) {
		return { message: 'Workspace path must be an absolute filesystem path.', ok: false };
	}
	return { cwd, ok: true };
}
```

**What.** The only test is "is it absolute". Nothing cross-references the `workspaces` table, so every downstream containment check (`resolveWorkspacePath`, `isWithinWorkspaceReal`, `validateRelativePath`) is relative to a root the caller chose. A renderer that asked for `workspaceCwd: '/Users/<user>'` would get a file listing, file reads, `git status`, `git add --all && git commit`, and `git push` against the user's home.

**Scenario.** Renderer compromise, or any future path that forwards an externally-supplied `workspaceCwd` into these handlers. This is **not** reachable from an agent today: the control server derives the path itself via `workspaceCwdFor(deps, caller.workspaceId)` (`agent-control/port-adapters.ts:1612`) from the token-resolved workspace id and never accepts a caller-supplied one — which is exactly right, and is what keeps this Low. It is recorded because it makes the control server's discipline load-bearing rather than defence-in-depth: one handler that forwards a caller path turns into a full escape with no second gate behind it.

**Existing guards & tests checked.** `validateCwd` additionally rejects NUL bytes and `statSync`-confirms a directory. No membership check anywhere.

**Fix.** Resolve `workspaceCwd` to a registered workspace row (canonicalized both sides) in the handler layer, and reject a path that matches none. The rows are already loaded for other purposes in most of these handlers.

### [FS-08] Per-turn checkpoints are written into the repository's shared object store, visible to every sibling worktree

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/checkpoints/git-checkpoint.ts:112`

```ts
await runGit({
    args: ['update-ref', ref, commitHash],
    cwd,
    step: 'update-ref',
});
```

**What.** `refs/ensemblr/checkpoints/<ws>/<turn>` is a *common* ref, not a per-worktree one (only `refs/bisect`, `refs/worktree/`, and `refs/rewritten` are per-worktree), so it and its objects live in `repos/<repo>/.git` and are reachable from every workspace of that repository. Each checkpoint commit is a full snapshot of the workspace's working tree.

**Scenario.** An agent in workspace B runs `git log refs/ensemblr/checkpoints/` and reads workspace A's entire working tree, including files A never committed. Both workspaces belong to the same repository and the same user, and `writeWorkingTree` uses `git add -A`, which respects `.gitignore` — so a gitignored `.env` stays out. What leaks is the untracked-and-not-ignored set. Rated Low because an agent that can read this already has shell in a workspace the user trusted; noted because it is a cross-workspace boundary the design otherwise maintains, and because "each workspace is isolated" is a reasonable thing for a user to assume.

**Existing guards & tests checked.** `REF_PATTERN` (line 51) and `sanitizeRefSegment` (line 60) confine writes to `refs/ensemblr/<namespace>/` — a caller genuinely cannot make `update-ref` move a branch or tag. `GIT_INDEX_FILE` points at a `mkdtemp` index so the user's real index, HEAD, and branches are untouched (`withTemporaryIndex`, line 128). Both are correct.

**Fix.** Documentation, most likely: state in ADR 0012 that checkpoint snapshots are repository-scoped rather than workspace-scoped. If genuine isolation is wanted, checkpoints would need their own object store per workspace, which trades away the deduplication that makes them cheap.

### [FS-09] Checkpoint capture runs `git add -A` and three full diffs per turn, with no timeout and a 16 MB buffer

- Severity: **Low** (performance)
- Confidence: **Confirmed**
- Where: `src/main/checkpoints/git-checkpoint.ts:159`, `:210`, `:320`

```ts
const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    env: { ...stripLaunchContextEnv(process.env), ...env },
    maxBuffer: 16 * 1024 * 1024,
});
```

**What.** Per agent turn: `git add -A -- .` into a throwaway index (a full working-tree scan), `write-tree`, `commit-tree`, `update-ref`. `diffTrees` then runs `--numstat`, `--name-status`, and a full patch **concurrently**, each buffering up to 16 MB. `runGit` passes no `timeout`, unlike every other git call site in the codebase — `localCommandService.run` requires one, `git-probe.ts:297` sets `GIT_COMMAND_TIMEOUT_MS`.

**Scenario.** A turn that regenerates a lockfile or a large generated file makes the three diffs buffer tens of megabytes simultaneously in the main process; one exceeding `maxBuffer` kills the child and surfaces as a `GitCheckpointError`. A git that wedges (a stuck `.git/index.lock`, a slow network filesystem) hangs the capture indefinitely, since there is nothing to time it out.

**Existing guards & tests checked.** `tests/main/checkpoint-capture.test.ts`, `tests/main/checkpoint-restore.test.ts`. No timeout assertion.

**Fix.** Add a `timeout` to `execFileAsync` in `runGit`, matching `GIT_COMMAND_TIMEOUT_MS`. Consider running the three `diffTrees` passes sequentially, or deriving `--numstat`/`--name-status` from one `--raw` pass, so peak buffering is one diff rather than three.

### [FS-10] `getEnvironment(cwd)` spawns a login shell inside the workspace

- Severity: **Info**
- Confidence: **Confirmed**
- Where: `src/main/environment/toolchain-path.ts:22`, `src/main/commands/local-command.ts:101`

**What.** `resolveCommandEnvironment` spawns the user's login shell to capture its environment, and `toolchain-path.ts` is the one caller that passes a `cwd`. A directory-aware tool the *user* has installed and hooked into their shell rc — `direnv`, `mise` — will then evaluate that workspace's `.envrc` / `mise.toml`.

**Why it is Info and not a finding.** The evaluation is done by the user's own shell configuration, which the threat model places outside the boundary, and `direnv` requires an explicit `direnv allow` per directory. It is recorded because it is the one place a repository's *contents* influence an environment the app then uses, and because the mitigation that makes it safe is elsewhere in the user's setup rather than in this code. Critically, it does **not** affect the app's own git: `LocalCommandService.run` calls `getEnvironment()` with no `cwd` (`local-command.ts:194`), so every `git`/`gh` invocation uses the process-default environment.

## Verified sound

**Spawned binaries.** No `shell: true` anywhere in `src/` (grep-confirmed). Every spawn is argv-array.

| Binary | Call site | How args are built | `--` before positionals | cwd / env |
| --- | --- | --- | --- | --- |
| `git` (general) | `repository/git-ops.ts:381`, `:680`, `:1043`, `:1082`, `:1166`, `:1193` | Constant subcommands; refs validated by `validate-git-ref.ts`; branch names only in `-b`/`-D` value position | n/a (no repo paths) | `cwd = repositoryPath`; env from `getEnvironment()` (login shell), no repo layer |
| `git worktree add` | `git-ops.ts:266` (`worktreeAddArgs`) | `-b <branch>` (value position), `<workspacePath>` computed from root + slugs, `<forkRef>` validated | n/a | as above |
| `git status/diff/checkout/rm` | `workspace-git/workspace-git-status.ts:296`, `:448`, `:553`, `:793`, `:810` | Repo-relative paths always after `--`; paths pass `validateRelativePath` (line 904) | **yes** | `cwd` = renderer-supplied (see [FS-07]) |
| `git ls-files` (files-to-copy) | `repository/files-to-copy.ts:172` | `--exclude-from=<mkdtemp path>` — repo patterns never enter argv | n/a | `cwd = repositoryPath` |
| `git` (checkpoints) | `checkpoints/git-checkpoint.ts:320` | Constants + tree/commit hashes; `-m <message>` value position; ref gated by `REF_PATTERN` | `add -A -- .` **yes** | `cwd = workspace`; `GIT_INDEX_FILE` = temp; fixed identity env |
| `git -C` (probe) | `repository/git-probe.ts:294` | `['-C', repositoryPath, ...constants]` — path is `-C`'s value | n/a | `stripLaunchContextEnv(process.env)`, `timeout` set |
| `git clone` (fallback) | `repository/clone-runner.ts:161` | `sanitizedUrl` always re-composed as `https://github.com/<owner>/<repo>.git` | no, but URL is synthesized | `stripLaunchContextEnv(process.env)` |
| `gh repo clone` | `repository/clone-runner.ts:140` | `validatedUrl` = `owner/repo` (see [FS-06]); `--` before the pass-through git args | partial | `stripLaunchContextEnv(process.env)` |
| `gh pr view/create/merge/api` | `github/github-service.ts:348`, `:643`, `:713` | `--title`/`--body`/`--base` value positions; `--<method>` from a `z.enum` (`request-schemas/github.ts:41`) | n/a | `cwd` = renderer-supplied |
| `du -sk` | `repository/directory-bytes.ts:27` | `['-sk', directoryPath]`, absolute path from DB; no `-L`, so symlinks are not followed | no (path absolute) | `cwd = directoryPath`, 60 s timeout |
| `open -b` / `open -a` | `open-target/open-target-service.ts:498`, `:518` | `bundleId`/`appName` from the fixed registry; path absolute | no (path absolute) | `OPEN_TIMEOUT_MS` |
| `gio launch` / `gtk-launch` | `open-target/linux-app-launch.ts:150` | Launcher resolved from XDG data dirs; path appended as a plain trailing arg | no (path absolute) | detached, login-shell env |
| `$VISUAL`/`$EDITOR`, `open -a TextEdit` | `config/open-in-editor.ts:25`, `:31` | Editor split on whitespace from the **user's own** env; file path is the app's config file only | no | detached |
| `security` (Keychain) | `secrets/keychain-backend.ts:252` | — | — | `stripLaunchContextEnv(process.env)` |
| login shell | `commands/command-environment.ts` | `-l` / `-c <command>` | n/a | see [FS-10] |
| PTY shells | `terminal/pty-backend.ts` | user-configured | n/a | workspace env layer (out of scope: user-declared) |

**Ref validation.** `validate-git-ref.ts:35` rejects whitespace, `: ? * [ \ ^ ~`, `..`, and a leading `-` **per `/`-separated segment** — the last point matters because `origin/--upload-pack=…` clears a whole-string check. It is applied at all four entry points where a ref can originate outside the app: `worktree-placement.ts:163` (base, adopted branch, fork ref), `create-workspace.ts:245` (`branchFrom` from the repository's committed `.ensemblr/settings.toml`), `set-workspace-base-branch.ts:158`, `rename-workspace.ts:441`. `toSlug` (`src/shared/slug.ts:12`) collapses to `[a-z0-9-]` and strips leading/trailing dashes, so an agent-supplied branch name cannot begin with one.

**Leading-dash branch names are refused by git itself** — confirmed against real `git` in a throwaway repo: `git branch -- -foo` → `fatal: '-foo' is not a valid branch name`, and `git worktree add --no-track -b -evil <path> main` fails before creating the directory. A workspace row can therefore not acquire a dash-leading branch that later reaches `git branch -D` or `gh pr view`.

**Deletion containment.** `classifyManagedChild` (`src/shared/managed-path.ts:22`) requires the candidate to start with `<root>/`, rejects empty/`.`/`..` segments (which closes the "empty slug collapses to the root" case), and requires an exact depth. `containmentRefusal` (`repository/managed-path.ts:35`) canonicalizes **both** sides with `realpathSync.native` first, so neither a row pointing through a symlink nor a symlink planted inside the root walks a removal out. `sweep-workspace-disk.ts` additionally re-checks in the instant before removal (`removalRefusal`, line 304), refuses any candidate holding a `.git`, and refuses on an unreadable database. `delete-repository.ts:531` is the important one and it is right: it refuses to delete a repository folder registered from outside the managed root, so "delete repository" never removes the user's own checkout.

**Attachment store.** `prepareContextSubdir` (`context-attachments.ts:394`) re-checks `isWithinWorkspaceReal` after **each** `mkdir` level. `attemptPlacement` stages with `flag: 'wx'` (`O_EXCL` refuses a symlink) and publishes with `link()` (`EEXIST` rather than write-through). Payloads arrive as base64, never as a path the caller names. Size caps: 10 MB images (`workspace-images.ts:15`), 50 MB hard ceiling (`context-attachments.ts:46`). Image magic bytes are checked against the declared MIME type, with WebP pinned by its RIFF marker at offset 8 and AVIF by `ftyp` brand.

**File listing and watching.** `walkIgnoredRoot` (`list-workspace-files.ts:669`) never pushes a symlink onto its walk stack — `Dirent.isSymbolicLink()` is lstat-derived, so a `link -> /` is a leaf — and caps at `IGNORED_ROOT_MAX_ENTRIES`/`MAX_ENTRIES`. The tracked listing comes from `git ls-files`, which cannot escape the work tree. The read path (`resolvePreviewRead`, line 763) applies `isWithinWorkspaceReal` for `workspace`-scoped paths in the documented order (size cap before realpath), so a committed `notes.md -> ~/.ssh/id_rsa` is refused. Watchers debounce at 250 ms with a 1 s max-wait, skip `.git` and `node_modules`, and the Linux leg caps at 4,096 directories and never descends a symlink.

**Environment.** `stripLaunchContextEnv` (`environment/launch-env.ts:60`) removes the launch-identity vars plus the full `GIT_*` repository-context set (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_CONFIG*`, `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`, …) and is applied at the final spawn boundary in `spawn-command.ts:66` as well as at each direct `execFile`/`spawn`. No repository `environment_variables` layer reaches the app's own git or gh invocations.

**Archive/copy.** `copyDirectoryTree` uses `dereference: false, verbatimSymlinks: true`; verified with real `fs.cp` that a symlinked source root is copied **as a link**, so archiving a workspace whose `.context` is a symlink does not copy the link's target. Archive destination paths are composed from slugs only.

**Clone.** No `--recurse-submodules` anywhere in `src/`, so a repository's `.gitmodules` (`url = ext::…`, or a path escaping the tree) is never acted on. URL patterns are anchored to `github.com` and reject `ext::`, `file://`, and local paths.

**Agent path resolution.** `agent-control/port-adapters.ts:1612` resolves the workspace cwd from the caller's token-derived `workspaceId`, never from a caller-supplied path. `linkedDirectories` — the only mechanism that grants a session a directory outside its workspace — is not reachable from `start_conversation` on the control server (grep: zero hits in `src/main/agent-control/`), so an agent cannot grant itself or a child one.

## Coverage

Read in full or in the relevant part: `workspace-files/{workspace-paths,workspace-cwd,context-attachments,workspace-images,list-workspace-files,watch-workspace-files,linux-recursive-watch}.ts`; `repository/{remove-directory,managed-path,delete-workspace,delete-repository,delete-archived-workspace,sweep-workspace-disk,worktree-placement,rehydrate-worktree,archive-workspace,copy-directory,files-to-copy,clone-runner,clone-destination,clone-classifier,target-path,github-url,validate-git-ref,slug,register-repository,quick-start-project,git-probe,directory-bytes,prune-worktree,create-workspace,adopt-shared-root/scan.ts}`; `git-ops.ts` (argument construction and every removal/spawn site); `commands/{local-command,spawn-command,command-request}.ts`; `checkpoints/git-checkpoint.ts`; `workspace-git/workspace-git-status.ts`; `open-target/{open-target-service,open-target-paths,linux-app-launch}.ts`; `config/{open-in-editor,context-directory}.ts`; `linked-directories/linked-directory-service.ts`; `environment/launch-env.ts`; `github/github-service.ts`; `shared/{managed-path,branch-name,branch-ref,slug}.ts`; `ipc/request-schemas/{repository,workspace-files,agent-session,github}.ts`.

Claims verified by running real `git` and real `fs` in throwaway `/tmp` repositories: leading-dash branch rejection (`git branch`, `git worktree add -b`); a committed `.context` symlink surviving `git worktree add` and `mkdirSync`+`writeFileSync` following it out of the tree; a committed `.context/attachments/ensemblr-review.md` symlink and `writeFileSync({flag:'w'})` replacing its target's contents; `fs.cp({dereference:false, verbatimSymlinks:true})` copying a symlinked source root as a link.

Not read in depth (low expected yield for this dimension, or owned by another auditor): `repository/{archive-lifecycle,archive-diagnostics,archive-records,issue-cache,list-*,github-branches,github-username,metadata,repository-sources-service,continue-workspace-branch,workspace-row-ops,row-guards,workspace-validation}.ts`; `root/*` beyond `root-inspect` signatures; `adopt-shared-root/{repository-adoption,workspace-adoption,stale-detection,branch-collisions}.ts`; `open-target/{open-target-registry,detect-installed-targets,linux-app-discovery}.ts`; the agent-control server itself.

## Open questions

1. **Does `composeActionPrompt` embed the PR body verbatim?** [FS-02]'s severity turns on how much of `prDescription` survives into the written file. `src/renderer/lib/workbench/action-prompts.ts:233` passes it through `requestedDetail`; if that truncates or re-templates aggressively, the finding drops to Medium (arbitrary-path write, app-chosen content). Worth ten minutes before triage.

2. **Is there a reason `ensureContextPath` does not do the realpath walk that `prepareContextSubdir` and `plan-file-writer` both do?** Its JSDoc explains the `mkdir(dirname)`-rather-than-`mkdir(full)` choice (so a background write cannot resurrect a pruned worktree) but says nothing about containment. If the omission is deliberate for a reason I did not find, that reason belongs in the JSDoc.

3. **Should a workspace row's `path` be trusted as an invariant, or re-asserted at each destructive use?** [FS-03] is Medium rather than High entirely because no current path produces an out-of-root row. That is a property of three other modules, not of the deletion code, and it is not asserted anywhere. A `CHECK`-style guard at the row-read boundary would make the four unguarded callers safe by construction.

4. **Is `core.untrackedCache` / `core.fsmonitor` acceptable to set on managed clones?** It is the single biggest lever on [FS-04] and costs one `git config` at clone time, but it writes into `repos/<repo>/.git/config`, which is shared with the user's own use of that checkout.
