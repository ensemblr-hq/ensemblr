# 03 — Plan-Mode Enforcement

Plan Mode's Pi leg is the strong one: an **allowlist** bash classifier, a
fail-closed per-call round trip to the app, no way for the agent to lift the
registry flag itself, and inheritance into spawned children. 217 of 294 adversarial
command strings were correctly denied, and the 77 allowed were almost all genuine
reads. Two things break it. First, `sort --compress-program=<prog>` runs an
arbitrary program and the classifier allows it — **confirmed by execution** on this
machine's own `sort`, and it breaks the Concierge containment rule too, since both
share `isReadOnlyBashCommand`. Second, the Claude leg rests on a single seam
(`permissionMode: 'plan'`) that Claude's own `ExitPlanMode` drops mid-turn, and
nothing re-asserts until the *next* prompt — in a trusted workspace the remainder of
that turn runs at `allowDangerouslySkipPermissions` with no `canUseTool` and no
`PreToolUse` hook. The agent-supplied plan title cannot traverse, the lexer has no
ReDoS (7.4 ms worst case at 50 KB), and `ensemblr_exit_plan_mode` cannot self-approve.

## Findings

### [PM-01] `sort --compress-program=<prog>` runs an arbitrary program from the read-only allowlist

- Severity: **Critical**
- Confidence: **Confirmed** — classifier verdict and real execution both reproduced.
- Where: `src/shared/plan-mode/bash-guard.ts:42` (`sort` on the allowlist),
  `src/shared/plan-mode/bash-guard.ts:270` / `:339` (the only guard `sort` carries)

```ts
const SORT_OUTPUT_FILE_GUARD: FlagGuard = {
	flags: new Set(['--output', '-o']),
	label: 'writes its output to a file',
};
...
	['sort', SORT_OUTPUT_FILE_GUARD],
```

- What: `sort` is allowlisted as read-only, and the one flag guard attached to it
  covers `--output`/`-o`. `sort` also accepts `--compress-program=PROG`, which names
  a program `sort` **execs** whenever it spills to a temporary file. The flag is absent
  from the guard, so the classifier clears the command, and every abbreviation clears
  too (`guardedFlagIn` matches by prefix against the guard's own set, which never
  contains it). Not a macOS quirk: `--compress-program` is GNU coreutils' flag, adopted
  by the BSD/Apple `sort` this machine ships, so both target platforms are affected. The
  Concierge guard calls the same classifier (`concierge-guard.ts:197`), so the same
  string also escapes the Concierge's "no writes outside my home" containment.
- Scenario: an agent in Plan Mode issues, as one `bash` tool call:

  ```
  sort -S 1 --compress-program=/tmp/gp/prog.sh med.txt > /dev/null
  ```

  Verdict from the real classifier:

  ```
  ALLOW "sort -S 1 --compress-program=/tmp/gp/prog.sh med.txt > /dev/null"
  evaluatePlanModeTool({tool:'bash', command: <above>}) => {"blocked":false}
  ```

  Executed for real against `sort (2.3-Apple)` with `prog.sh` doing
  `touch /tmp/gp/PWNED_SORT` and `echo … > /tmp/gp/WROTE.txt`:

  ```
  $ ls -la PWNED_SORT WROTE.txt
  -rw-------  0  PWNED_SORT
  -rw------- 19  WROTE.txt
  $ cat WROTE.txt
  arbitrary code ran
  ```

  The helper runs as the user, so `prog.sh` is a full shell — `rm -rf`, `git commit`,
  `curl | sh`, anything. The trailing `> /dev/null` keeps the redirection scanner
  satisfied. The agent needs one executable path, and any repo checkout already has
  dozens of executable scripts on disk.
- Existing guards/tests checked: `tests/shared/plan-mode-bash-guard.test.ts` probes
  `sort -o`, `--out=`, `--outp=`, `--outpu`, `-no`, `-no/tmp/out` and `-T/tmp/sort-work`
  — the whole `sort` corpus is the output-file axis. The only *program-running* flags
  probed anywhere are `fd -x`, `rg --pre`, `rg --hostname-bin` and `git grep -O`, which
  are exactly the cases the author thought of. On an allowlist, a missed flag on an
  allowlisted command is the only shape this class can take, and it takes it here.
- Fix: give `sort` its own `FlagGuard` whose `flags` holds `--compress-program` as
  well as `--output`/`-o`, with a label naming what it does ("runs a program to
  compress its temporary files"). No short spelling exists, so the cluster scan is
  untouched and `sort -S`, `sort -T/tmp/x`, `sort -no` keep working. Then sweep the
  rest of `READ_ONLY_COMMANDS` for the same shape — a flag whose *value* is a program
  name — and add a test that asserts each allowlisted command's program-running flags
  are guarded, so the next `--pager`-style flag fails a test rather than a report.

### [PM-02] Claude's native `ExitPlanMode` releases the live session for the rest of the turn

- Severity: **High**
- Confidence: **Confirmed** (code path; the premise is the repo's own recorded behaviour)
- Where: `src/main/claude-agent/claude-agent-adapter.ts:389`

```ts
	// The SDK leaves plan mode as it runs its own `ExitPlanMode`, without
	// telling the adapter and without landing on the workspace's baseline.
	// Forgetting the applied value is what makes the next turn re-assert: …
	appliedPlanMode = null;
	onPlanSubmitted?.({ agentSessionId, controlToken, submission });
```

- What: on the Claude path Plan Mode is *only* `permissionMode: 'plan'`
  (`claude-permission-bridge.ts:108`). `MUTATING_TOOLS` is withheld for the `read-only`
  workspace mode alone, explicitly because "`plan` alone would still let the model edit
  once it left plan mode via its own `ExitPlanMode` call" (`:41`). That sentence is
  equally true of the plan-mode *toggle* on a `workspace-trusted` workspace, where
  `resolvePermissionSettings` returns `{allowDangerouslySkipPermissions: true,
  permissionMode: 'plan'}` and `buildCanUseTool` returns `undefined` (`:133`). When the
  model calls `ExitPlanMode` the adapter records `appliedPlanMode = null` and files the
  plan — it does **not** call `activeQuery.setPermissionMode('plan')`. Re-assertion
  happens in `applyTurnSelection`, which runs only on the *next* non-steer `submit`
  (`claude-agent-adapter.ts:707`, early-returning on `request.streamingBehavior`). So
  between the `ExitPlanMode` call and the user's decision the runtime has no gate at
  all, while the registry, the composer lock and the toggle all still say "planning".
  Pi is fail-closed in exactly this window: `handleExitPlanMode`
  (`agent-control-service.ts:3327`) never clears the registry.
- Scenario: chat toggle on, workspace `workspace-trusted`. The model emits
  `ExitPlanMode{plan:"…"}` and then, in the same assistant turn, `Write{file_path:"src/x.ts"}`
  followed by `Bash{command:"git commit -am wip"}`. Claude's ExitPlanMode protocol
  *tells* the model to stop; nothing *makes* it. The user sees a review panel they have
  not answered and a dirty working tree.
- Existing guards/tests checked: `tests/main/claude-plan-mode-persistence.test.ts` covers
  the next-turn axis only ("re-asserts plan mode on the turn after a plan was submitted",
  "returns a trusted workspace to bypass when the user approves", "skips the switch for a
  mid-turn steer"). Nothing asserts the window *inside* the submitting turn, because the
  adapter takes no action there. `tests/main/claude-session-permission-mode.test.ts:472`
  pins `allowDangerouslySkipPermissions === true` while planning, so the fallback level is
  deliberate and tested — it is the release that is unguarded.
- Fix: in `forward()`, alongside `appliedPlanMode = null`, `void
  activeQuery?.setPermissionMode('plan')` before dispatching `onPlanSubmitted` — the same
  call `applyTurnSelection` already makes, moved to the moment the transition is observed.
  Belt and braces: add `MUTATING_TOOLS` to `disallowedTools` whenever `planMode` is true,
  not only for `read-only`; the deny list is evaluated independently of the mode, which is
  the argument `:63` already makes.

### [PM-03] Plan Mode has one enforcement seam on Claude where the Concierge deliberately has two

- Severity: **Medium**
- Confidence: **Likely** (code path confirmed; the exploit needs a user `permissions.allow` rule I could not exercise here)
- Where: `src/main/claude-agent/claude-concierge-guard.ts:9-14` versus
  `src/main/claude-agent/claude-agent-adapter.ts:780`

```ts
 * Two seams, because one of them is not enough on its own. `canUseTool` is the
 * SDK's permission surface and never fires under `bypassPermissions` … the
 * `PreToolUse` hook resolves before permissions are consulted at all, so it also
 * holds against an allow-rule in the user's own `settings.json` that would
 * otherwise pre-approve a write and skip `canUseTool` entirely.
```

- What: the Concierge's containment rule is enforced twice — `canUseTool` *and* a
  `PreToolUse` hook — for the reason quoted above. Plan Mode gets neither: the hook map
  is `withAfkHooks(concierge?.hooks, isUnattended)`, so a plan session registers none,
  and `canUseTool` is `undefined` outside `approval-required`. Meanwhile the session
  opens with `settingSources: ['project', 'user']` (`claude-agent-adapter.ts:811`),
  which loads the user's `~/.claude/settings.json` and the project's
  `.claude/settings.json` — their `permissions.allow` rules and their own MCP servers
  included. Whether an allow-rule outranks `--permission-mode plan` inside the CLI is
  the open question; its strings suggest plan mode is a mode-level gate ("in plan mode
  the approval must come from the user, not the auto-permission classifier"), but
  Ensemblr is relying on an internal of a binary it neither ships nor pins.
- Scenario: user has `"permissions": {"allow": ["Write", "Bash(git commit:*)"]}` in
  `~/.claude/settings.json` (a common convenience). A planning Claude session issues
  `Write`. If the allow rule is consulted before the mode gate, the write lands with
  no Ensemblr-side check anywhere in the path.
- Existing guards/tests checked: `tests/main/claude-session-permission-mode.test.ts`
  asserts the *options* handed to `query()`, never the CLI's resolution of them.
  `tests/main/afk-claude-hook.test.ts` shows the hook machinery exists and is easy to
  extend. Nothing tests plan mode against a settings file.
- Fix: register a `PreToolUse` hook for a planning session that denies
  `Write`/`Edit`/`MultiEdit`/`NotebookEdit` and routes `Bash` through
  `isReadOnlyBashCommand`, exactly as `createConciergePreToolUseHook` does. One matcher;
  it closes PM-02 as a side effect (the hook reads live state at call time) and removes
  the dependence on a CLI internal.

### [PM-04] `ensemblr_set_branch_name` renames the git branch the bash guard refuses to rename

- Severity: **Medium**
- Confidence: **Confirmed** (code path)
- Where: `src/shared/plan-mode/control-ops.ts:32` (`PLAN_MODE_BLOCKED_OPS`, which omits it),
  `src/main/agent-control/agent-control-service.ts:3673`

```ts
const PLAN_MODE_BLOCKED_OPS: ReadonlyMap<AgentControlOp, string> = new Map([
	['launchHarness', …], ['startTerminal', …], ['writeTerminal', …],
	['startReview', …], ['resolveDiffComments', …],
	['updateArchitectureDiagram', …],   // "a working tree left untouched is the
	['linearCreateIssue', …],           //  one thing planning promises"
	['linearUpdateIssue', …],
]);
```

- What: `setBranchName` is in `WRITE_OPS` (`src/shared/agent-control/contracts.ts:162`)
  and reaches `applyBranchSlug` → `renameWorkspaceService.rename`, which moves the
  underlying git branch (`src/main/repository/rename-workspace.ts:129-146`). It is not
  in `PLAN_MODE_BLOCKED_OPS`, nor Concierge-only, nor withheld from a root. So a
  planning orchestrator can do through a control tool precisely what `git branch -m` —
  denied by name at `bash-guard.ts:135` (`GIT_REF_MUTATING_FLAGS` holds `-m`, `-M`,
  `--move`) — would have done. `updateArchitectureDiagram` is blocked one entry away
  because a tracked-file write "lands in the user's `git status`"; a branch rename is at
  least as visible.
- Scenario: planning root calls `ensemblr_set_branch_name({name: "refactor-auth"})`.
  The branch is renamed under the user while they are still reading a plan they have not
  approved, and upstream tracking on the old name breaks. Gated only behind Settings →
  Git → "let agents name the workspace and branch" (`port-adapters.ts:1585`), which is a
  naming preference, not planning consent.
- Existing guards/tests checked: `tests/main/plan-mode-op-policy.test.ts` is "an
  exhaustive table" per ADR 0044 §4 — exhaustive over the *stated* policy, so an op
  nobody classified passes. ADR 0044:170 omits it too.
- Fix: add `setBranchName` to `PLAN_MODE_BLOCKED_OPS` with a reason naming the branch
  move, and put the rename in the plan. Then re-walk `WRITE_OPS` against that map and
  record why each remaining reachable write op is deliberate — `addDiffComments`,
  `setWorkspaceStatus`, `closeTab`, `stopTerminal`, `spawnChatTab`, `setName`,
  `setSummary` all read as intentional; `setBranchName` does not.

### [PM-05] The Pi extension intercepts eight hard-coded tool names, so any other write tool bypasses Plan Mode unseen

- Severity: **Medium**
- Confidence: **Confirmed** (extension source + classifier verdict)
- Where: `resources/pi-extensions/ensemblr-control.mts:478` and `:1117`

```ts
const PLAN_MODE_GUARDED_TOOLS = new Set(['bash', 'edit', 'write']);
…
	pi.on('tool_call', async (event) => {
		if (!GUARDED_TOOLS.has(event.toolName)) {
			return;                       // never forwarded, never classified
		}
```

- What: the hook filters on a union of eight literal names before it asks the app.
  Anything else — a write tool from another Pi extension the user installed, or a tool
  from an MCP server in their Pi configuration — is never forwarded, so
  `checkPlanModeTool` never sees it and no policy applies. The app-side classifier
  agrees: `evaluatePlanModeTool({tool:'mcp__filesystem__write_file'})` returns
  `{"blocked":false}`, as does `{tool:'apply_patch'}`. The file's own comment names the
  risk for Pi built-ins but treats it as a parity problem between two lists rather than
  an open set the user can extend.
- Scenario: user has a filesystem MCP server configured for Pi. A planning agent calls
  `mcp__filesystem__write_file{path:"src/x.ts", contents:"…"}`. The hook returns early,
  the app is never asked, the file is written.
- Existing guards/tests checked: the parity test ADR 0044 §1 describes pins the
  extension's set against `tool-guard.ts:33` — it proves the two lists match, which is
  orthogonal to whether the list is complete.
  `tests/shared/plan-mode-tool-guard.test.ts` probes only the three names.
- Fix: invert the filter. Ask the app about **every** tool call and let
  `evaluatePlanModeTool` decide, defaulting an unknown tool name to blocked with a reason
  that names it. If that proves chatty, keep a fast path for an explicit read-only
  allowlist (`read`, `glob`, `grep`, …) and forward the rest — the shape the bash
  classifier already chose, for the same reason.

### [PM-06] `resolveDisallowedTools`' `depth` is never passed, so every native-delegation descendant keeps Claude's own sub-agent tool

- Severity: **Medium**
- Confidence: **Confirmed** (code path; the only production call site takes no `depth`)
- Where: `src/main/claude-agent/claude-agent-adapter.ts:756`,
  `src/main/claude-agent/claude-subagent-mode.ts:27`

```ts
	const disallowedTools = resolveDisallowedTools({
		delegation: request.delegation ?? 'ensemblr',
		permissionDisallowedTools: permission.disallowedTools,
	});                                   // ← no `depth`, so it defaults to 0
```

- What: `resolveDisallowedTools({delegation, depth = 0, …})` denies `Agent`/`Task`
  unless `delegation === 'native' && depth === 0`, and its JSDoc states "A descendant
  is denied regardless of mechanism, because its one remaining edge must stay on
  authoritative Ensemblr lineage." The only production call site omits `depth`, and
  `AgentSessionRequest` (`src/main/agent-runtime/agent-types.ts:174`) carries no depth
  field for it to pass — the parameter is unreachable. Under `delegation: 'native'`
  every session is treated as a root, so a spawned Ensemblr child keeps Claude's native
  sub-agent tool. That matters here because a native sub-agent's tool calls never
  traverse Ensemblr's control layer — no `isPlanning`, no `checkPlanModeTool`, no
  control-op gate — leaving Plan Mode leaning entirely on the CLI propagating
  `--permission-mode plan` into its own sub-agents.
- Scenario: user sets delegation to `native`. A planning root spawns an Ensemblr
  sub-agent; that child still holds `Task`, spawns a Claude-native sub-agent, and asks
  it to edit. Whether the edit lands is the CLI's business, not Ensemblr's — the
  property ADR 0044 §5 says the design refuses to accept.
- Existing guards/tests checked: `tests/main/claude-subagent-mode.test.ts` calls
  `resolveDisallowedTools` directly with an explicit `depth`, so the contract is tested
  and the *wiring* is not; every session in
  `tests/main/claude-session-permission-mode.test.ts` opens under the default `ensemblr`
  mechanism, where the deny list is unconditional.
- Fix: thread the origin's depth onto `AgentSessionRequest` and pass it here; or, if
  depth is genuinely unavailable at adapter level, delete the parameter and deny
  `Agent`/`Task` whenever the session was spawned rather than opened by the user — so the
  function cannot claim a guarantee it is not given the input to make.

### [PM-07] `file -C -m <magicfile>` creates a file while Plan Mode is on

- Severity: **Low**
- Confidence: **Confirmed** (reproduced)
- Where: `src/shared/plan-mode/bash-guard.ts:34` (`file` on the allowlist, no flag guard)
- What/scenario: `file -C -m <path>` compiles the named magic source and writes
  `<path>.mgc` beside it. `file -C -m /tmp/gp/magic` → classifier `ALLOW`; on disk,
  `-rw-r--r-- 752 /tmp/gp/magic.mgc` appeared. Weak primitive — the output is a compiled
  magic database and the source must parse (`file -C -m README.md` errored and wrote
  nothing) — but it is a file created where the agent chooses while writes are blocked.
- Existing guards/tests checked: nothing in `tests/shared/plan-mode-bash-guard.test.ts`
  touches `file`.
- Fix: a `FlagGuard` for `file` on `--compile`/`-C`, labelled "writes a compiled magic
  file". `file -m` alone stays readable.

### [PM-08] A `\`-newline line continuation injects a phantom token and falsely blocks read-only commands

- Severity: **Low**
- Confidence: **Confirmed** (reproduced)
- Where: `src/shared/plan-mode/shell-lexer.ts:324`

```ts
	if (char === '\\') {
		sink.push(command[index + 1] ?? '');
		return { next: index + 2 };
	}
```

- What/scenario: bash deletes `\<newline>` entirely; the lexer pushes the newline in as a
  one-character token, landing between the head word and its arguments. `git \`⏎`status`
  → `deny: \`git \n status\` is not a read-only git subcommand`. `cat \`⏎`foo` survives
  only because `cat` needs no argument analysis; the same shape breaks `gh`, `uniq` and
  every flag-guard scan on a multi-line command — which is how an agent writes a long
  `rg`/`git log`. Fail-closed, so a usability defect rather than a hole, but it spends a
  turn and teaches the agent to reformat around the guard.
- Existing guards/tests checked: `tests/shared/plan-mode-shell-lexer.test.ts` covers
  `ls /tmp/my\ dir` and "drops the leading backslash of an unquoted escape"; no case
  pairs `\` with a newline.
- Fix: in the `\\` branch, when the next character is `\n`, consume both and push
  nothing.

### [PM-09] The lexer's whitespace is JavaScript's, not bash's

- Severity: **Info**
- Confidence: **Confirmed** (reproduced)
- Where: `src/shared/plan-mode/shell-lexer.ts:54-63`, `:338` (`/\s/.test(char)`)
- What: bash's blanks are space and tab. JavaScript's `\s` additionally matches `\r`,
  `\v`, `\f`, U+00A0 and the Unicode space separators, so the lexer splits words bash
  keeps whole. Every case I probed lands in the over-splitting direction and is
  therefore safe — `cat a<NBSP>rm b` classifies as head `cat` while bash passes
  `a<NBSP>rm` to `cat` as one argument — but it means the classifier's view of a
  command is provably not bash's, and any future rule that reasons from token
  *positions* (as `evaluateUniq` and `refArgumentsWithoutValues` already do) inherits
  the divergence.
- Scenario: `cat a<U+2028>rm f`, `cat a<U+000B>rm f`, `cat<NBSP>-la` — all `ALLOW`.
  None reaches a writer.
- Fix: narrow the two whitespace tests to `[ \t]` (the `\n` separator is already
  explicit) so word boundaries match bash's, with a test naming each character.

### [PM-10] A plan is filed on the tool *call*, before the runtime has accepted it

- Severity: **Info**
- Confidence: **Confirmed** (code path)
- Where: `src/main/claude-agent/claude-plan-mode.ts:46`
- What: `detectPlanSubmission` matches `event.payload.kind === 'tool-call'`, so the
  plan is written to `.context/plans/`, posted into the timeline and broadcast as a
  review panel the moment the model *emits* `ExitPlanMode`, whatever the CLI's
  permission engine then does with it. With no `canUseTool` wired the SDK answers a
  `can_use_tool` control request by throwing (`sdk.mjs`: `if(!this.canUseTool) throw
  Error("canUseTool callback is not provided.")`), so a denied exit still leaves the
  user a review panel.
- Fix: gate the bridge on the tool's *result* rather than its call, or accept it and
  say so — the current comment reads as though the two are the same event.

## Verified sound

Each probed against the real classifier (a throwaway harness under `/tmp` importing
`src/shared/plan-mode/bash-guard.ts` directly) unless noted.

**The design is an allowlist, not a denylist** — the single most important property of
the file, and it holds. `evaluateSegment` (`bash-guard.ts:768-806`) ends in
`deny(\`${head}\` is not on the Plan Mode read-only allowlist)`, so novelty fails closed:
`sponge`, `doas`, `parallel`, `chattr`, `setfacl`, `shred`, `xattr`, `pbpaste`,
`launchctl`, `osascript`, `tmux`, `screen`, `crontab`, `at`, `docker`, `deno`, `cargo`,
`go`, `tsc`, `printf`, `install`, `dd`, `truncate`, `rsync`, `patch`, `wget`, `sqlite3`,
`ed`, `ex`, `vim`, `nano`, `emacs`, `less`, `more`, `man` were all denied without one of
them appearing anywhere in the module.

Blocked, with the line that blocks it:

- **Redirections** — `> f`, `>> f`, `>| f`, `&> f`, `2> f`, `>& f`, `3> f`, `0> f`,
  `<> f`, `>/dev/stdout`, `>/dev/fd/3`, `>/dev/null/x`, `>/dev/nul`, `> "f"`, `> $f`,
  `>&-`: `shell-lexer.ts:169-186` + `:292-306`. `>/dev/null`, `2>&1`, `>&2`, `1>&2`
  allowed and nothing else; the descriptor prefix check at `:298` is what refuses `3>`.
- **Process substitution** — `<(…)`, `>(…)`: `shell-lexer.ts:273`, `:331`.
- **Heredocs and herestrings** — `<<EOF`, `<<'EOF'`, `<<"EOF"`, `<<-EOF`, `<<<`:
  `shell-lexer.ts:276`.
- **Command substitution** — `$(…)`, backticks, nested, and inside double quotes:
  `shell-lexer.ts:87-95`, reached from both `step` and `scanDoubleQuoted`.
- **Separators** — `;`, `&&`, `||`, `&`, `|`, `|&`, newline: each segment classified
  independently (`bash-guard.ts:800`), so `cat a && rm b`, `cat a > /dev/null; rm b`
  and `cat f | rm` all deny on the second segment.
- **Grouping** — `(rm f)`, `{ rm f; }`, `! rm f`, `f(){ rm x; }; f`, `function f { … }`:
  the group character stays in the head token, which is not on the allowlist.
- **Quoting and escaping of the head word** — `r\m f`, `''rm f`, `"rm" f`, `'r''m' f`,
  `\rm f`, `rm"" f`, `$'\x72m' f`, `${RM:-rm} f`, `{rm,f}`, `cat${IFS}f`, fullwidth
  `ｒｍ f`: all denied. `c\at f` and `\cat f` resolve to `cat` and are allowed, which is
  bash's own reading.
- **Path-spelled writers** — `/bin/rm`, `./rm`, `/usr/bin/env rm`, `/bin/c?t`, `/???/rm`:
  denied. The allowlist matches the head token exactly, so even `/bin/cat` is refused.
- **Environment manipulation** (the class #491 addressed, re-probed wider) —
  `PATH=`, `BASH_ENV=`, `ENV=`, `NODE_OPTIONS=`, `PYTHONSTARTUP=`, `PERL5OPT=`,
  `RUBYOPT=`, `DYLD_INSERT_LIBRARIES=`, `GIT_DIR=`, `XDG_CONFIG_HOME=`, `HOME=`,
  `IFS=`, `PROMPT_COMMAND=`: `bash-guard.ts:773-778`. `a[0]=x cat f` and
  `export`/`declare -x` fall to the allowlist instead. `env cat f` denies at
  `CODE_EXECUTION_COMMANDS` (`:64`) even for a read-only payload.
- **Interpreters and wrappers** — `bash -c`, `sh -c`, `zsh -c`, `fish -c`, `ksh -c`,
  `dash -c`, `python -c`, `node -e`, `perl -e`, `ruby -e`, `php -r`, `awk 'BEGIN{…}'`,
  `sed -i`, `sed s///w`, `eval`, `exec`, `source`, `command`, `builtin`, `nice`,
  `nohup`, `time`, `timeout`, `sudo`, `watch`, `script`, `xargs`, `tee`: `:57-83` plus
  the allowlist.
- **`find`** — `-delete`, `-exec`, `-execdir`, `-ok`, `-okdir`, `-fls`, `-fprint`,
  `-fprint0`, `-fprintf`: `bash-guard.ts:86-96`. `-name`, `-newer`, `-ls`, `-printf`,
  `-o` stay readable.
- **git write porcelain** — `add`, `commit`, `stash`(bare), `stash push`, `checkout --`,
  `reset --hard`, `clean`, `apply`, `am`, `rebase`, `push`, `fetch`, `gc`, `fsck`,
  `init`, `worktree add`, `worktree --porcelain add`, `config <k> <v>`, `update-ref`,
  `symbolic-ref`, `notes add`, `remote add`, `submodule update`, `filter-branch`,
  `mv`, `rm`, `tag`, `merge`, `cherry-pick`, `replace`, `hash-object -w`, `mktree`,
  `pack-refs`, `repack`, `prune`, `reflog expire`, `maintenance run`, `daemon`,
  `send-email`, `bisect run`, `archive -o`, `bundle create`, `branch -m`,
  `branch --list -D`: `evaluateGit` (`:679`) + the subcommand allowlist (`:99`).
- **git program injection** — `-c`, `--config-env`, `--exec-path` and their
  abbreviations: `skipGitGlobalFlags` (`:530`). `git -C -c log` and
  `git --git-dir -c log` clear the classifier because `-C`/`--git-dir` consume the
  next token, but git itself then reads `-c` as a directory/gitdir and fails — checked
  and not exploitable.
- **gh** — `pr create`, `pr merge`, `api -X POST`, `alias set`, `auth token`,
  `repo clone`, `workflow run`, `secret set`, and `gh --repo o/r pr view` (over-blocked):
  `evaluateGh` (`:716`).
- **Package managers** — `npm install`, `npm run`, `npx`, `npm exec`, `pip install`,
  `make`, and the three blocked-by-policy managers: `:57-83`.
- **`uniq <in> <out>`**, including `uniq -- a b`: `evaluateUniq` (`:487`).
- **`fd -x`, `rg --pre`, `rg --hostname-bin`, `date -s`, `sort -o`, `tree -o`,
  `git grep -O`, `git … --output`** — every flag guard fired, in bare, `=value`,
  abbreviated and clustered spellings. `fd -tfx` and `tree -Po out.txt` are allowed by
  design because clap/getopt swallow the guarded letter into the preceding value; both
  match the real binaries' parsing.

Other surfaces:

- **`ensemblr_exit_plan_mode` cannot lift Plan Mode.** `handleExitPlanMode`
  (`agent-control-service.ts:3327`) requires `originHasChatTab` and `isPlanning`, then
  delegates to `createPlanSubmission.submit`, which saves, posts, broadcasts and calls
  `markSubmitted` (`exit-plan-mode.ts:106-121`). Nothing calls `setActive(false)`.
  The registry is cleared only from the IPC handler the renderer drives
  (`setAgentPlanModeRequestSchema`, `src/main/ipc/request-schemas/agent-session.ts:67`),
  i.e. by the user's Approve / Hand off / toggle. **An agent cannot self-approve.**
- **Sub-agents inherit Plan Mode.** `startConversation` passes
  `planMode: isPlanning(origin) || args.planMode === true`
  (`agent-control-service.ts:1809`), and `agent-control-service.ts:1697-1701` refuses a
  caller that tries to *state* `planMode` itself. Covered by
  `tests/main/plan-mode-spawn-inheritance.test.ts`.
- **Follow-up cannot be laundered into an edit.** `planModeFollowUpDenial`
  (`control-ops.ts:145`) refuses a follow-up to a non-planning target and names the
  spawn route instead.
- **The plan file cannot traverse.** `toSlug` (`src/shared/slug.ts:12`) collapses every
  non-alphanumeric run to `-`, so `../../etc/passwd` becomes `-etc-passwd`;
  `planFileStem` then wraps it in `path.basename` (`plan-file-writer.ts:99`); and
  `preparePlansDirectory` (`:138`) `realpath`s every level and refuses one that leaves
  the workspace. Three independent guards on an agent-supplied title.
- **Fail-closed control channel.** The Pi extension blocks the call when the app cannot
  be reached (`ensemblr-control.mts:1138-1143`) and asks per call rather than caching,
  so a mid-turn approval cannot be served from a stale "not planning".
- **No ReDoS.** 50 KB pathological inputs through `isReadOnlyBashCommand`: 50 k `(`
  5.0 ms, 50 k `"` 1.4 ms, 50 k `-` 2.3 ms, 50 k-char assignment prefix 2.7 ms, 50 k `\`
  0.6 ms, 50 k `;` 6.1 ms, 16 k nested quotes 1.6 ms, 16 k flag tokens 7.4 ms, 6 k git
  flags 3.1 ms, 50 k `>` 0.0 ms. Every regex in the module (`/^[A-Za-z]*/`,
  `/^([A-Za-z_][A-Za-z0-9_]*)=/`, `/\s/`, `/[ \t]/`) is linear and un-nested, and the
  lexer is a single forward walk.
- **Per-call round-trip cost.** One loopback HTTP `invoke` per guarded tool call, on
  `bash`/`edit`/`write` only. Negligible beside the tool's own work, and the correct
  trade for the staleness argument at `ensemblr-control.mts:1114-1116`.

**Documented limitation, not a finding:** Plan Mode does not reach terminal harnesses.
`isPlanning` requires a chat tab (`agent-control-service.ts:917`), and a `claude`/`codex`
TUI launched in a terminal owns a terminal tab. This is stated rather than assumed:
`control-ops.ts:34` blocks `launchHarness` while planning precisely because a harness
"has no Plan Mode of its own and launches with approval prompts skipped", `startTerminal`
because a terminal "is a raw shell the read-only command rules cannot reach", and
`SECURITY.md` says harnesses launch with auto-approve by design. A harness already
running when the toggle is flipped keeps running unrestricted — correct per the model,
worth a sentence in the user-facing Plan Mode copy.

## Coverage

Read in full: `src/shared/plan-mode.ts`, `src/shared/plan-mode/{bash-guard,shell-lexer,
tool-guard,control-ops,block-reason}.ts`, `src/main/plan-mode/{index,exit-plan-mode,
plan-mode-registry,plan-file-writer}.ts`, `src/main/claude-agent/{claude-plan-mode,
claude-plan-bridge,claude-permission-bridge,claude-subagent-mode}.ts`. Read in part:
`src/shared/plan-mode/concierge-guard.ts` (shared-classifier seam), the plan-mode
sections of `src/main/claude-agent/claude-agent-adapter.ts` and
`src/main/agent-control/agent-control-service.ts`,
`src/shared/agent-control/{contracts,subagent-policy}.ts` (op / write-op / withholding
tables), the plan-mode paths of `resources/pi-extensions/ensemblr-control.mts`,
`docs/adr/0044`, `SECURITY.md`. Test corpora read to avoid duplicate reporting:
`tests/shared/plan-mode-{bash-guard,shell-lexer,tool-guard}.test.ts`,
`tests/main/{claude-plan-mode-persistence,claude-session-permission-mode,
plan-mode-spawn-inheritance,claude-subagent-mode}.test.ts`.

Not probed, each needing a running app this audit did not start: whether Claude Code's
CLI propagates `--permission-mode plan` into its own `Task`/`Agent` sub-agents; whether
a `permissions.allow` rule outranks plan mode inside that CLI (PM-03); the `Skill`
tool's shell execution under plan mode. `WebFetch`/`WebSearch` were reasoned about and
dismissed — neither writes the workspace. `evaluateConciergeTool`'s own path rules are a
sibling policy and out of this dimension.

## Open questions

1. **Does a user `permissions.allow` rule outrank `--permission-mode plan` in the Claude
   CLI?** PM-03's severity hinges on it, and it is testable with a scratch
   `~/.claude/settings.json` and one planning session. If yes, PM-03 is High.
2. **Do Claude-native sub-agents inherit the parent's permission mode?** If not, PM-06
   is a plan-mode bypass rather than a delegation-policy defect.
3. **Is `allowDangerouslySkipPermissions` wanted on a planning session at all?** It is
   only a capability grant for `bypassPermissions`, inert while the mode is `plan` — but
   it is what makes PM-02's window as wide as it is, and dropping it while planning costs
   nothing until Approve, which re-resolves the settings anyway.
4. **Should the classifier answer for Claude's tool names too?**
   `evaluatePlanModeTool({tool:'Write'})` returns `{blocked:false}` because the set holds
   Pi's lower-cased names. Correct today, and wrong the moment PM-03's hook lands — that
   hook would need the Concierge's capitalized set or it would wave every Claude write
   through.
