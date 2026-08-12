# Security Policy

## Read this first: Ensemblr is not a sandbox

Ensemblr runs AI coding agents **with shell access**, on your machine, under your own user account and
your own shell environment. Anything an agent can run, you could have run yourself. This is deliberate —
the agent needs your toolchain, your `PATH`, and your credentials to be useful — but it means the trust
boundary is *the repository you opened*, not the app.

Concretely:

- An agent in a workspace can read and write files, run commands, and reach the network as you.
- A repository's `.ensemblr/settings.toml` declares setup, run, and archive scripts. **Creating a
  workspace runs that repository's setup script.** Opening an untrusted repository in Ensemblr is
  equivalent to running its scripts.
- Terminal harnesses are launched with their auto-approve flags set, by design.
- The default workspace permission mode is `workspace-trusted`. `approval-required` and `read-only` exist
  and are set per repository under Settings → Repo → Security.

An agent doing something destructive inside a workspace you trusted is not a vulnerability in Ensemblr.
An agent doing something Ensemblr's permission model says it cannot do **is**.

## In scope

- **Privilege escalation past the control channel** — a sub-agent obtaining an operation withheld from
  sub-agents, an agent moving an issue to a completed or canceled state, or any bypass of the workspace
  permission mode.
- **Plan-mode bypass** — reaching a write tool while a session is held in plan mode.
- **The loopback control server** — accepting a non-local caller, accepting a request without a valid
  per-session bearer token, or leaking a token across workspaces.
- **Secrets escaping the Keychain** — a stored credential written to disk, a log, a support bundle, or a
  prompt.
- **IPC handlers accepting unvalidated renderer input** in a way that reaches the filesystem, the shell,
  or the database.
- **Build integrity** — code signing, notarization, or build-channel identity.

## Out of scope

- Destructive agent behaviour inside a workspace whose repository you trusted.
- A malicious third-party repository's setup, run, or archive script.
- The supply chain of your own `pi`, `claude`, `codex`, or `gh` binaries, and the models they call.
- Anything requiring an attacker who already has local code execution as your user.

## Reporting

**Do not open a public issue.**

- Preferred: GitHub's **private vulnerability reporting** on this repository (Security → Report a
  vulnerability).
- Or email **philipp@soldunov.dev**.

Please include the version and build channel, macOS version, which agent runtime was involved, and the
smallest reproduction you have. A proof of concept is welcome; please do not test against anyone else's
machine or data.

## What to expect

- Acknowledgement within 5 working days.
- An assessment and a plan, or an explanation of why the report is out of scope, within 15 working days.
- Coordinated disclosure: I will agree a date with you rather than publish unilaterally, and credit you in
  the release notes unless you prefer otherwise.
- There is no bug bounty.

## Supported versions

Pre-1.0: only the latest release is supported. There are no backported security fixes to older builds.
