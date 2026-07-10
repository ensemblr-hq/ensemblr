# 0031. Strip macOS Launch-Context Env from Children and Hold a Single-Instance Lock

Date: 2026-07-10

## Status

Accepted

Relates to [0003](0003-preserve-pi-user-environment.md) (preserve the user's
Pi environment) and [0028](0028-use-launch-services-for-open-workspace-in-app.md)
(drive other apps through Launch Services).

## Context

The packaged app intermittently flashed a stray second Dock icon and, in the
worst case, booted a whole second instance (its own window, its own Dock tile).
Forensics traced it to two independent mechanisms, both rooted in how macOS
Launch Services attributes processes:

- **Inherited launch-context environment.** When macOS launches a GUI app it
  injects `__CFBundleIdentifier` (the launching bundle id, `com.ensemble.app`)
  and `XPC_SERVICE_NAME` (the launchd application-instance identity,
  `application.com.ensemble.app.<asn>`), with `XPC_FLAGS` and `LaunchInstanceID`
  travelling in the same launchd context. Every child Ensemble spawns —
  a terminal PTY, a git/`gh` subprocess and its credential/askpass helper, a
  keychain `security` call, a GUI editor launch, the Pi agent and transitively
  its extension children, the login-shell environment probe — inherits those
  variables through `process.env`. The moment such a child touches Launch
  Services (a terminal running `open`, an editor registering itself, a tool
  shelling out) macOS treats it as *that bundle id* and attributes it to, or
  relaunches, Ensemble. Electron's own `ELECTRON_RUN_AS_NODE`,
  `ELECTRON_NO_ATTACH_CONSOLE`, and `ELECTRON_NO_ASAR` markers similarly steer a
  child Electron/Node process into behavior meant only for this process.

- **Direct-exec relaunch bypassing Launch Services dedup.** A spawned login
  shell that re-execs the bundle's binary directly does not route through Launch
  Services, so the normal single-app dedup never fires and a second instance
  boots.

A separate root cause — a dev bundle-id collision where an Electrobun
`Ensemble-dev.app` shared `com.ensemble.app` under `electrobun dev --watch` — was
fixed on its own by giving each channel a distinct bundle id. That stops the
primary trigger, but any child that inherits the launch-context markers can
still re-arm the flash, so the mitigation below is the durable, defense-in-depth
cure rather than a point fix.

Ensemble must not strip the *user's* environment: ADR 0003 commits us to handing
Pi the full login-shell environment (PATH, SHELL, tool config). The fix must
remove only the macOS/Electron launch markers, never user variables.

## Decision

### 1. A pure `stripLaunchContextEnv` applied at every spawn boundary

`src/main/environment/launch-env.ts` exports a single pure function that returns
a copy of an environment with exactly these keys removed:

- `__CFBundleIdentifier`
- `XPC_SERVICE_NAME`, `XPC_FLAGS`, `LaunchInstanceID`
- `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ATTACH_CONSOLE`, `ELECTRON_NO_ASAR`

Nothing else is touched, so the user environment ADR 0003 preserves is intact.
The function is generic in the env shape (`Record<string, string>` in →
`Record<string, string>` out) so no call site needs a type assertion.

It is applied with a layered, strip-more-than-once discipline:

- **Once at the shared source.** `createLocalCommandService` strips its
  `baseEnv` before it seeds anything. That single strip covers the login-shell
  environment probe (`loadShellEnvironment` spawns `$SHELL -lic` with the base
  env) and every command resolved from that snapshot, including the Pi RPC
  readiness smoke.
- **Explicitly at each independent spawn site** that builds its env from
  `process.env` directly: git checkpoints, `spawn`/clone runners, the "open in
  editor" launch, `pmset` battery reads, git probes, and keychain `security`
  calls.
- **At the final boundary** for the highest-risk children, so no upstream env
  assembler can smuggle the markers back in: the generic command spawner, the
  terminal PTY env merge, `buildSpawnEnv` for the real Pi spawn, and the Pi RPC
  smoke spawn.

### 2. A single-instance lock on the packaged app

`main.ts` acquires `app.requestSingleInstanceLock()` before `app.whenReady()`.
The instance that loses the lock quits, and a guard in the `whenReady` handler
stops it from touching shared userData on its way out. A `second-instance`
handler in the surviving instance focuses (and un-minimizes, or recreates) the
existing window instead of letting a new instance live. The lock keys on
userData, so it also catches direct-exec relaunches that bypass Launch Services,
not just `open`-routed ones. The handler logs the blocked launch's `argv` and
working directory to Console.app as forensics for any surviving relaunch
trigger.

**Dev is deliberately excluded from the lock.** Dev builds share one
`Ensemble (DEV)` userData across Conductor workspaces, so a lock there would kill
the second dogfooding instance. The lock is gated behind `!isDev` and acquired
after `app.setName` so it keys on the correct userData.

## Alternatives Considered

### Fix only the dev bundle-id collision

Giving each channel a distinct bundle id (done separately) removes the primary
trigger but not the mechanism: any child inheriting the launch-context markers
can still be attributed to Ensemble. Rejected as incomplete.

### Rely on the single-instance lock alone

The lock folds a relaunch into the running instance, but a blocked instance
still *boots and quits* — the Dock flash the user sees. Stripping the env
prevents the trigger; the lock is the backstop for whatever still slips through.
Both layers are kept.

### Strip in one central spawn wrapper

There is no single spawn chokepoint: children are spawned by scattered services
(git, keychain, terminal, Pi, editor launch) that assemble env differently.
Rather than force every path through one wrapper, we strip once at the shared
`baseEnv` source and again at each independent boundary. The redundancy is
intentional and cheap (a shallow object copy).

## Consequences

- No child process can be mistaken for, or relaunch, Ensemble via inherited
  launch-context env, and a direct-exec relaunch of the packaged app folds into
  the running instance instead of booting a second one.
- The user environment is untouched, so Pi and terminals keep the full
  login-shell env per ADR 0003.
- The packaged app is now strictly single-instance. Any future "open a second
  window" affordance must go through the existing window/IPC, not a second
  process.
- Dev builds remain multi-instance for Conductor dogfooding; the lock is a
  packaged-only behavior, so dev and packaged diverge here by design.
- The strip is duplicated across ~11 call sites. New spawn sites must apply
  `stripLaunchContextEnv` at their boundary; the shared-source strip only covers
  children built from the local-command base env.

## Source pointers

- `src/main/environment/launch-env.ts` — the pure strip and the key list.
- `src/main/commands/local-command.ts` — the shared-source strip on `baseEnv`.
- `src/main/commands/spawn-command.ts`, `src/main/repository/clone-runner.ts`,
  `src/main/repository/git-probe.ts`, `src/main/checkpoints/git-checkpoint.ts`,
  `src/main/secrets/keychain-backend.ts`, `src/main/pi-agent/macos-battery.ts`,
  `src/main/config/open-in-editor.ts` — per-site strips.
- `src/main/terminal/terminal-service.ts` — PTY env merge, strip before and
  after overlay.
- `src/main/pi-agent/cli-rpc/spawn-env.ts` (`buildSpawnEnv`) and
  `src/main/pi-runtime/pi-rpc-smoke.ts` — Pi spawn final-boundary strips.
- `src/main/main.ts` — single-instance lock, `whenReady` guard, and
  `second-instance` handler.
- `tests/main/launch-env.test.ts` — unit coverage for the strip.
