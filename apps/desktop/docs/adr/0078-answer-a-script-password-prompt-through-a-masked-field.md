# 0078. Answer a Script's Password Prompt Through a Masked Field

Date: 2026-09-28

## Status

Accepted

## Context

A setup or run script in `.ensemblr/settings.toml` that calls `sudo` hangs.

The script runs as `shell -c <command>` inside a real PTY, so `sudo` finds a
terminal and prints its prompt there. The main process accepts a write to any
session. Only the renderer stops input: the Setup and Run panes pass `readOnly`
to `XtermTerminal`, which sets xterm's `disableStdin` and never subscribes to
`onData`. `docs/ux-conventions.md` records these panes as read-only output tabs.
They are read-only so that a stray keystroke cannot reach a dev server, and so
that the pane never takes focus from the composer.

So the prompt is shown, and the user has nowhere to type the answer.

## Decision

**The panes stay read-only. When a script stops on a password prompt, a masked
field is floated over the pane.**

- **Main detects the prompt.** Every setup-script and run-script output chunk
  updates a 512-character tail. `detectSecretPrompt`
  (`src/main/terminal/secret-prompt.ts`) strips the escapes from that tail. It
  reads only the line the cursor is on. It matches a line that names a password
  or passphrase and ends in a colon. That covers `sudo`, `sudo-rs`, `doas`,
  `ssh`, and `git` over HTTPS, in English and in the common translations,
  Russian and Greek included.
- **The snapshot carries it.** `TerminalSessionSnapshot.secretPrompt` holds the
  prompt line, or `null`. It follows the precedent of `previewUrl`: main stamps
  it and broadcasts only when the value changes. The next line of output clears
  it, because a program that has read its answer moves to a new line. Exit
  clears it too.
- **The renderer shows a field.** `buildScriptSummary` carries the prompt only
  while the session is running. `scriptSummaryToDockStatus` reads it as
  `warning`, so the tab asks for attention while the dock shows another tab.
  `SecretPromptBar` sends the value through its own
  `answerTerminalSecretPrompt` channel and clears the field. It stays away from
  the activity watcher's `emitTerminalInput` and never stores the value outside
  its own component state. An empty field sends nothing, because a bare Enter
  counts as a wrong password. The dock keys the bar by terminal and prompt, so a
  half-typed draft never carries over to a different prompt.
- **Main answers only a live prompt.** The generic `writeTerminalSession`
  channel would write to any session at any time. If the prompt went away just
  before the user pressed Enter, the password would reach whatever reads stdin
  next. `answerSecretPrompt` writes `value + '\r'` only while the session is a
  running setup or run script that still shows a prompt. It then clears the
  prompt in the same step, so a second submit is refused. It reports
  `answered: false` otherwise, and the field says the send failed.
- **Main masks an echoed answer.** A program that reads the password with echo
  on, such as `read -p` without `-s`, prints it back. Main keeps the answer
  until the output line it could be echoed on has ended. It replaces the answer
  on that line with a fixed-length mask before the chunk reaches scrollback, the
  on-disk log, the renderer, or any scanner. Then it forgets the answer.
- **The field never takes focus on its own.** If it did, a chat draft typed into
  it by accident would reach `sudo` as a password. The lit tab leads the user to
  the field, and the user clicks into it.

## Alternatives considered

- **Make the Setup and Run panes interactive.** This is the smallest change and
  it answers any prompt, not only a password. It was rejected because it undoes
  the read-only convention. Once the pane has focus, any keystroke, `Ctrl+C`
  included, reaches a long-running dev server.
- **Ship an askpass helper.** Ensemblr would set `SUDO_ASKPASS` for script
  environments and require `sudo -A`. It was rejected because every script would
  have to change, it covers `sudo` only, and the password would travel over the
  agent-control loopback server. Script kinds deliberately do not receive that
  overlay.
- **Document workarounds only** (`pkexec`, a GUI askpass, `NOPASSWD` rules). This
  was rejected as the only answer, because a script committed for a team cannot
  assume any of them.

## Consequences

- `sudo` in a setup or run `command` works. Only a person can answer it. An agent
  that starts such a script through agent control sees it wait.
  `ensemblr_list_terminals` does not report `secretPrompt` yet.
- The archive script has no pane, so a prompt there still hangs.
- The detector is a heuristic.
  - A prompt that names neither a password nor a passphrase, or that does not
    end in a colon, is not recognised. The spawn terminal remains the answer for
    that case.
  - A log line that ends in `password:` and has not yet received its newline can
    raise the field until the rest of that line arrives.
- Masking an echoed answer is best effort. It covers a program that echoes the
  answer as plain text on the answer's own line. It does not cover a program
  that redraws the line with escapes, or an echo that arrives only after some
  other output has already ended the line. A script that must not show the
  password should read it with echo off.
- The field floats over the top of the pane and covers its first lines. It
  repeats the prompt text itself, so a short pane loses nothing.
