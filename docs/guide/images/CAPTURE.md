# Screenshot capture list

Every image in this directory is produced by **demo mode** — a second Electron
entrypoint that renders the real app against scripted fixtures. A shot is not
staged by hand any more; it is a scenario file, so re-taking the whole set after
a UI change is a loop rather than an afternoon.

```sh
npm run dev:demo -- --shoot --scenario=<id>     # one shot into out/demo/<id>.png
npm run dev:demo -- --scenario=<id>             # open it and compose by eye; ⌘D for the toolbar
```

See [`demo/README.md`](../../../demo/README.md) for how to write a scenario and
[ADR 0058](../../adr/0058-capture-promotional-screenshots-from-a-separate-demo-electron-entrypoint.md)
for why the capture path is a separate entrypoint rather than a dev-only branch
inside the app.

## Rules for every shot

- **The scenario is the shot.** Reshooting means running the command above, not
  reproducing a state on someone's machine. If a shot is wrong, the fix belongs
  in `demo/scenarios/<id>.ts`, where the next person inherits it.
- **Dark theme, default accent, one window size.** Every scenario inherits
  `DEFAULT_DEMO_WINDOW` (1496×933) unless it says otherwise, which is what keeps
  mixed sizes out of the set.
- **Nothing needs scrubbing.** The fixtures are invented — two repositories that
  do not exist, issues that were never filed, a `~/Code/workspaces/…` tree that
  is nobody's home directory. That is the point of staging the shots rather than
  shooting real work: there is no Linear title to redact, no account block to
  pixelate, and no absolute path to blur. Keep it that way — a scenario must
  never be pointed at a real repository to get a better shot.
- **Full native resolution, no crop, no quantization.**
  `screencapture -o -l <windowId>` returns the window alone on a transparent
  canvas — no drop shadow, no wallpaper, the rounded corners already cut. On a
  Retina display that is a 2× PNG at 2992×1866 for the default window, and it is
  kept at exactly that size and exactly those colours. The set this replaced was
  downscaled to 1600px wide, which is where its softness came from.
- **2992×1866 is the ceiling, and it is a hardware one.** The capture is the
  window server's own pixels, so the resolution is the window's point size times
  the display's backing scale — 1496×933 at 2× on a 3024×1964 panel. A window
  cannot be sized past the desktop it lives on, and forcing a higher device scale
  factor only makes Chromium rasterize into a surface the compositor still shows
  at 2×. To go higher, capture on a display with a larger backing store; there is
  no software lever.
- **Budget: 600 KB per image, 9 MB for this directory.** The set in place is
  7.2 MB across twenty-one shots, averaging 343 KB — roughly nine times what the
  downscaled set cost, for four times the pixels and no lossy step. The two
  create-workspace dialogs are the heaviest at ~550 KB, because a long list of
  distinct rows is the worst case for PNG.

### Processing a raw capture

One command. There is no crop step, because there is nothing to crop, and no
quantization step, because a 256-colour palette is exactly the kind of softening
these shots are meant not to have.

```sh
oxipng -o 4 --strip safe -q <target>.png
```

Copy the raw capture to its target name first — `oxipng` rewrites in place. That
takes a ~680 KB capture to roughly 370 KB with every pixel intact. If the
directory ever runs past its budget, drop a shot rather than quantizing the set:
`pngquant --quality 90-100` halves the size at an RMSE of 0.5%, which is
invisible in isolation and visible when a reader flips between two images
processed differently.

## The list

Every shot below is `npm run dev:demo -- --shoot --scenario=<scenario>` followed
by the two commands above.

| File | Scenario | Page | What it must show |
| --- | --- | --- | --- |
| `00-hero-orchestrator.png` | `hero-orchestrator` | `README.md` | The whole workbench at once: an orchestrator's timeline with its delegates in the tab strip, the diff in the Changes panel, the dev server streaming in the dock. The one shot people see before they read anything. |
| `00-hero-dashboard.png` | `board` | `README.md` | The dashboard board with workspace cards across every column. |
| `02-settings-diagnostics.png` | `settings-diagnostics` | `02-requirements.md`, `14-troubleshooting.md` | Settings ▸ More ▸ Diagnostics, the full rollup, with **one check not passing** so its remediation buttons are visible. |
| `03-wizard-welcome.png` | `onboarding-welcome` | `03-first-run.md` | The setup wizard's welcome screen: the language picker and one row each for an agent CLI, the GitHub CLI, and Linear. |
| `03-wizard-agent-cli.png` | `onboarding-agent-cli` | `03-first-run.md` | The agent CLI step with **one runtime satisfied and the other not** — Pi "Not installed", Claude Code "Ready", step green. The most misunderstood screen in the app. |
| `03-root-directory.png` | `settings-general` | `03-first-run.md` | Settings ▸ General, the Ensemblr root directory row with its Browse button and resolved path. |
| `03-create-workspace.png` | `create-workspace-sources` | `03-first-run.md` | The create-workspace dialog with all three source tabs visible (pull request, branch, issue). |
| `05-create-workspace.png` | `create-workspace-branches` | `05-workspaces.md` | The same dialog on the Branches tab, showing the row actions a branch another workspace already holds gets — *Open* and *Duplicate branch* — against a free branch that offers neither. |
| `05-board.png` | `board-card-menu` | `05-workspaces.md` | The board with one card's action menu open, beside the sentence that describes it. Not the same shot as `00-hero-dashboard.png` — the open menu is the point. |
| `06-chat.png` | `workspace-mid-turn` | `06-agents.md` | The chat timeline mid-turn with tool cards, the model picker, and the context gauge visible. |
| `06-plan-mode.png` | `plan-mode` | `06-agents.md` | Plan mode active in the composer, with a submitted plan raised in the review panel. |
| `06-chat-light.png` | `workspace-mid-turn-light` | `11-app-settings.md` | The same workspace and the same turn as `06-chat.png`, on the light theme — the shot the Appearance section points at. |
| `06-concierge.png` | `concierge` | `README.md`, `06-agents.md` | The Concierge panel open over the board, reading across every workspace at once. |
| `07-dock-run-scripts.png` | `dock-run-picker` | `README.md`, `07-terminals-and-run-scripts.md` | The dock with a run script running **and** the run-script picker open, so the named scripts and their icons are legible. |
| `08-changes.png` | `review-changes` | `README.md`, `08-reviewing-changes.md` | The diff viewer with an inline review comment thread open. |
| `08-pr.png` | `checks-pull-request` | `08-reviewing-changes.md` | The Checks tab with the PR title and description editor filled in, over its check runs. |
| `09-subagents.png` | `subagent-fanout` | `09-agent-control.md` | An orchestrator fanned out across four delegates, each a tab in the strip. |
| `10-linear.png` | `linear-issues` | `10-integrations.md` | The Linear view, issues grouped by state. |
| `11-settings-providers.png` | `settings-providers` | `11-app-settings.md` | The Providers pane on the Pi tab, with the executable override control visible. |
| `11-settings-providers-claude.png` | `settings-providers-claude` | `11-app-settings.md` | The same pane on the Claude Code tab, for the Account block the Pi tab has no equivalent of. |
| `13-shortcuts.png` | `settings-shortcuts` | `13-keyboard-shortcuts.md` | Settings ▸ More ▸ Shortcuts, showing the scope groups. |

A page still missing its shot carries an
`<!-- screenshot: <file> — <what it shows> -->` marker at the exact spot the
image belongs. Replace it with the image rather than adding one beside it:

```markdown
![Alt text describing what the shot shows, not the word "screenshot".](./images/<file>)
```

Every shot in the list has a scenario, so nothing here is taken by hand any
more. `demo/README.md` lists two more that no page uses yet — `dock-terminal`,
the dock with its picker closed, and `board`, the board with no menu open —
kept because they are the cleaner shot when a page needs the surface without the
control on top of it.

## Adding a shot

Write the scenario first; do not stage a replacement by hand. If a surface turns
out to need a change under `src/` to reach, say so in the scenario file rather
than working around it — demo mode imports the app read-only, and
`tests/renderer/demo-isolation.test.ts` enforces that in both directions. Most
state that looks unreachable is not: a component's own `useState` is reached with
an `interactions` gesture, which is how the dialog, context-menu, and Plan Mode
shots are staged.
