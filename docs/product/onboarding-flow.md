# Onboarding Flow

Date: 2026-06-04

No onboarding screenshots were captured under `.context/conductor-screens/01-onboarding/`. This flow is inferred from ADR 0014 and from the setup, provider, root, repository, clone, and workspace screens in the screenshot inventory.

## Setup Gate Sequence

Piductor should not drop users into a workspace that cannot run the core workflow. First launch should perform a required setup gate, then open the first useful project/workspace path.

1. Welcome and local-execution notice

   Explain that Piductor runs Pi, git, scripts, terminals, and tools locally with the user's macOS account permissions. Link to security/privacy settings.

2. Root directory selection

   Choose or confirm the Piductor root directory. Default to `~/Piductor`. Show that managed repositories, workspaces, and archived contexts live under this root. Warn before using a non-empty or shared Conductor root.

3. Core local tooling checks

   Verify git is installed and runnable. Verify Electron can launch shell commands with the expected user environment. Verify SQLite opens and migrations run.

4. GitHub checks

   Verify `gh` is installed and `gh auth status` succeeds. If not, show installation/auth instructions. This is required for Conductor-like PR/checks/merge parity in v1.

5. Pi runtime checks

   Discover or load the configured Pi-compatible executable. Verify it can report version/help where supported and start `--mode rpc` from a test workspace. Verify Pi auth/model/provider readiness through compatible commands or safe RPC smoke test where practical. Confirm project-local Pi resource discovery will use workspace `cwd`.

6. Managed directory checks

   Create or validate `repos/`, `workspaces/`, and `archived-contexts/` under the configured root.

7. Linear integration

   Offer Linear sign-in as a first-class integration path. Linear is required for issue CRUD and workspace-from-issue flows, but should not block local/GitHub-only project setup unless the user chooses a Linear workflow.

8. First project path

   Offer Open local project, Clone GitHub project, Open Linear issue, and Quick start. If recent projects exist, show recents after required checks pass.

9. First workspace path

   After adding a project, create or open the first workspace, show the new-workspace landing summary, and focus the Pi composer.

## Required Checks

| Check | Required for ready state | Success state | Failure remediation |
| --- | --- | --- | --- |
| Git executable | Yes | Git version detected. | Install git or Xcode Command Line Tools; retry check. |
| Shell/process launch | Yes | Commands can run with expected environment. | Show captured environment/path issue and retry. |
| SQLite database | Yes | DB opens and migrations pass. | Show database path and migration error; allow retry after fixing permissions/disk. |
| Root directory | Yes | Root exists and managed subdirectories exist. | Choose a writable directory or grant permissions. |
| GitHub CLI installed | Yes for v1 | `gh` executable detected. | Install GitHub CLI and retry. |
| GitHub CLI authenticated | Yes for v1 | `gh auth status` succeeds. | Run `gh auth login` or fix token/account. |
| Pi executable/RPC readiness | Yes | Selected Pi-compatible executable launches and RPC smoke test passes. | Install/configure Pi, select a compatible executable or wrapper, then retry. |
| Pi agent directory | Yes | Pi agent directory resolves. | Fix Pi environment path or directory permissions. |
| Pi provider/model readiness | Yes | At least one usable Pi model/provider is available through the selected executable. | Open Pi/provider settings, authenticate, configure provider variables, or select another executable. |
| Managed subdirectories | Yes | `repos/`, `workspaces/`, `archived-contexts/` exist. | Create directories or choose another root. |
| Linear OAuth | Required for Linear workflows | Linear connection succeeds and teams/issues can be read. | Sign in to Linear, reconnect, or continue without Linear workflows. |

## Failure and Remediation States

### Missing Git

- Show: git is required for repository and workspace isolation.
- Actions: install command-line tools, open docs, retry.
- Blocking: yes.

### Missing or Unauthenticated GitHub CLI

- Show: GitHub CLI is required for PRs, checks, comments, and merge flow.
- Actions: install `gh`, run `gh auth login`, retry, open advanced GitHub settings.
- Blocking: yes for v1 parity.

### Pi Executable, RPC, or Provider Not Ready

- Show: Pi runtime is required before starting an agent session.
- Actions: open Pi provider/settings remediation, inspect Pi agent directory, retry.
- Blocking: yes.

### Root Directory Not Writable

- Show: Piductor needs a writable managed root for repositories and workspaces.
- Actions: choose another folder, retry, open folder permissions guidance.
- Blocking: yes.

### Shared or Non-Empty Root Warning

- Show: the selected root may contain existing Conductor/Piductor-managed content.
- Actions: adopt/reindex existing workspaces when supported, choose another root, or continue with explicit confirmation.
- Blocking: only if unsafe or not writable.

### Database Migration Failure

- Show: database path and migration identifier, without secrets.
- Actions: retry, open diagnostics, choose a clean app profile only if explicitly supported.
- Blocking: yes.

### Environment Variable or Secret Issue

- Show: which required variable/provider setting is missing without revealing secret values.
- Actions: add variable, open provider settings, retry.
- Blocking: only when it prevents Pi or GitHub readiness.

## First Successful Path Into First Workspace

1. User launches Piductor.
2. Setup gate runs and shows required checks.
3. User confirms root directory or chooses a new one.
4. Required checks pass.
5. User chooses Clone GitHub project, Open local project, Open Linear issue, or Quick start.
6. If the user selected a Linear issue, Piductor links the issue metadata and uses it to seed workspace name, branch, and initial Pi context.
7. Piductor creates or registers the repository under the root layout.
8. Piductor creates the first git worktree workspace from the configured default branch.
9. Piductor copies eligible gitignored files according to `.worktreeinclude`, repository settings, or defaults.
10. Piductor runs setup script if configured, or shows optional setup-script guidance if missing.
11. Piductor opens the workspace landing state with file tree, checks panel, terminal dock, linked Linear issue context when present, and Pi composer ready.
12. First prompt creates a Pi session using workspace `cwd` and normal Pi resource discovery.

## Piductor-Specific Copy and UI Guidance

- Do not use Conductor screenshots as visual templates.
- Use Piductor labels, icons, empty states, and remediation copy.
- Keep first-run language explicit about local execution and Pi environment preservation.
- Make every failed check actionable with a retry button and log details.
- Do not print secrets, tokens, private account identifiers, or private repository paths in remediation text unless the user explicitly expands diagnostic detail.
