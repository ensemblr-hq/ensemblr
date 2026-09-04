# Demo mode

A second Electron entrypoint that renders the **real** app against scripted
fixtures, for capturing promotional and documentation screenshots.

```sh
npm run dev:demo
```

Nothing under `src/` is modified to support this. Demo mode imports the app
read-only, Forge is not involved, and the packaged build contains none of it.
See [ADR 0058](../docs/adr/0058-capture-promotional-screenshots-from-a-separate-demo-electron-entrypoint.md).

`playground/` is a **separate** thing — a component-review sandbox — and is off
limits to this tree. The guard test in `tests/renderer/demo-isolation.test.ts`
enforces it in both directions.

## Scenarios

| id | What it shows |
| --- | --- |
| `hero-orchestrator` | The whole workbench: an orchestrator, its delegates, the diff, the dock |
| `workspace-mid-turn` | An agent mid-turn: reasoning, tool cards, streaming answer |
| `workspace-mid-turn-light` | The same turn in the light theme, and nothing else |
| `plan-mode` | Plan Mode on, with a finished plan waiting on the user |
| `subagent-fanout` | Four delegates, each in its own tab with its own transcript |
| `review-changes` | The diff viewer with an inline review comment thread |
| `checks-pull-request` | The Checks tab over an open PR with its check runs |
| `dock-terminal` | The dock with a dev server streaming, real xterm |
| `dock-run-picker` | The dock's Run tab with the run-script picker open |
| `board` | The kanban board with cards across every column |
| `board-card-menu` | The board with one card's context menu open |
| `create-workspace-sources` | The create-workspace dialog on its Pull requests tab |
| `create-workspace-branches` | The same dialog on Branches, held branch against free ones |
| `linear-issues` | The Linear view, grouped by state |
| `concierge` | The Concierge panel open over the board |
| `onboarding-welcome` | The setup wizard's welcome screen and language picker |
| `onboarding-agent-cli` | The wizard's either-or agent-CLI gate, one runtime missing |
| `settings-providers` | Settings → Providers with both runtimes healthy |
| `settings-providers-claude` | The same pane on the Claude Code tab, with its account block |
| `settings-general` | Settings → General, scrolled to the root directory row |
| `settings-diagnostics` | Settings → Diagnostics, the full rollup with one warning |
| `settings-shortcuts` | Settings → Shortcuts, the scope groups and their bindings |

## Composing a shot

1. `npm run dev:demo` opens the window on the first scenario.
   `-- --scenario=<id>` opens a specific one.
2. Edit a file under `scenarios/`. The window repaints over HMR — no restart.
3. `⌘D` toggles the toolbar: scenario, theme, frozen/live motion, shoot.

The toolbar hides itself before capturing, because a toolbar in frame is the one
thing a promotional screenshot must not contain.

**A finished turn folds its whole activity run into one summary row.**
`ChatAssistantTurn` expands the reasoning and tool cards only while the turn has
no final answer yet, so on a scenario with `isStreaming: false` a chat pane is
filled by the length of the final message and not by adding tool calls — which
make it *shorter*, by collapsing into `3 tool calls, 2 messages`. A scenario that
wants the cards themselves on camera has to be mid-turn.

## Writing a scenario

One file per scenario in `scenarios/`, registered in `scenarios/index.ts`.

```ts
export default defineScenario({
  id: 'workspace-mid-turn',
  label: 'Workspace, mid-turn',
  route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
  workspaceId: 'ws-release-notes',
  clock: '2026-09-04T11:20:00.000Z',
  repositories: [ /* … */ ],
  gitFilesByPath: { '~/Code/workspaces/ensemblr/release-notes': [ /* … */ ] },
  chat: {
    isStreaming: true,
    transcript: buildTranscript(BRANCH_ID, CLOCK, [
      userPrompt('…'),
      reasoning('…'),
      toolCall('Read', 'call-1', { file_path: '…' }),
      toolResult('call-1', '…'),
      assistantText('…'),
    ]),
  },
});
```

A scenario's `subAgents` are full chats, not just tab rows: each carries its own
`branchId`, its own session, and its own transcript, so opening a delegate's tab
shows the work it actually did. `listAgentSessionEvents` answers per `branchId`,
which is what keeps them apart.

`route` is a hash route, so every scenario is addressable. `?scenario=<id>` picks
one; `?step=<n>` truncates the transcript to `n` events and `?step=live` replays
it on a timer, which is what raises the working indicator and a mid-run tool
card.

Transcripts are **back-dated** from `clock`, so elapsed-time labels read
plausibly rather than `0.0s`.

## Which surfaces a scenario has to feed

`handlers.ts` answers the bridge calls the workspace-chat route makes. Everything
it does not name resolves to a no-op, so a route that reaches further shows an
empty panel rather than a wrong value — add the handler when you add the surface.

Currently answered: navigation, health, setup diagnostics, app settings, system
languages, provider readiness and executable paths, the managed root directory,
resolved repository settings (which is where the dock reads its run scripts
from), chat tabs, agent sessions and their events, the live event subscription,
models, slash commands, git status, file diffs, the workspace file tree, review
comments and todos, checkpoints, the pull-request snapshot, the create-from
picker's branches / pull requests / issues, terminal sessions and their
scrollback, Linear connection / issues / metadata, the Concierge session and
transcript, open targets, the menu bar, context pressure, and update status.

Some state belongs to no bridge call at all, and the scenario model carries a
field for each:

- `openDiffPath` opens a diff as its own tab, which is the state a review shot
  wants and the one `reviewTab` alone does not reach.
- `concierge` raises the panel through the same focus broadcast main sends, and
  `planReview` raises the plan decision bar through `onExitPlanMode`. Both are
  pushes rather than answers.
- `setupChecks` feeds the diagnostics rollup *and* the onboarding wizard, which
  read the one snapshot — `handlers.ts` derives the counts and the overall status
  the way the main process does, so the summary strip cannot disagree with the
  rows under it.
- `boardStatusByWorkspaceId` and the Plan Mode chip are seeded into
  `localStorage`, because both are persisted atoms rather than IPC calls. Every
  scenario clears the Plan Mode keys, so one plan shot cannot leave the chip on
  in the next.
- `interactions` covers everything else: state a component owns in a `useState`
  that no route reaches. A gesture is `click`, `context-menu`, `press-key`, or
  `scroll-into-view`, addressed by CSS selector and optionally narrowed by
  visible text. They run one per poll once the queries have settled, so a gesture
  that opens a dialog has rendered before the next one looks for anything in it.

Reaching a surface this way is deliberate and is the only option: demo mode
imports the app read-only, and `tests/renderer/demo-isolation.test.ts` enforces
that in both directions. Prefer a fixture where one will do — a gesture is for
state the app will not take from data.

## Capture

```sh
npm run dev:demo -- --shoot --scenario=board
```

Waits for the renderer to settle, captures, and quits. Stills are written to
`out/demo/` (gitignored) by `screencapture -o -l <windowId>`, which addresses the
real window and therefore captures the traffic lights, the corner radius, and the
drop shadow on a transparent canvas. On a Retina display that is a 2× PNG.

Determinism comes from three things, none of them a timeout:

- the frozen clock (`frozen-clock.ts`),
- `.demo-frozen` on the root element, hiding the caret, killing every transition,
  and pinning every animation to one frame. Pinning, not stopping: it pairs
  `animation-play-state: paused` with a ten-second negative `animation-delay`,
  so a finite animation is held *after* its last frame rather than before its
  first. Pausing alone photographed every Radix overlay — the dialogs, dropdowns
  and context menus scenarios open — at the `opacity: 0` its `animate-in` starts
  from,
- the `data-demo-ready` attribute, set once queries have settled, the scenario's
  gestures have been applied and settled again, and `document.fonts.ready` has
  resolved. Shiki tokenizes asynchronously and xterm silently substitutes a
  fallback for a face that has not finished loading, so a fixed delay catches
  whichever lost the race.

Post-processing — cropping, downscaling, `pngquant`, `oxipng` — follows the
recipes already written down in
[`docs/guide/images/CAPTURE.md`](../docs/guide/images/CAPTURE.md).

## Known limits

- The macOS menu bar reads `Electron`, because demo mode runs the raw binary
  rather than a packaged bundle. Crop it, as `CAPTURE.md` already requires.
- Shiki's light theme is not on camera anywhere. `workspace-mid-turn-light` is
  the only light shot, and a finished turn folds its tool cards into one summary
  row, so no highlighted block is in frame. Deliberate: a scenario existing only
  to exercise a highlighter is not worth its reshoot cost.
- Video is not implemented. When it is, the path is `ffmpeg -f avfoundation`
  cropped to the window's own bounds, or deterministic frame-stepping of the
  playhead assembled with ffmpeg — not a `capturePage` loop, which drops frames.
