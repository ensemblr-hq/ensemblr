# Screenshot capture list

Fourteen shots are in place. **One is still outstanding** — `08-changes.png`,
the diff viewer with an inline review comment thread open, at
`08-reviewing-changes.md:9`. `05-board.png` was dropped: the board section of
`05-workspaces.md` reuses `00-hero-dashboard.png`, which is the same screen.

Each page still missing its shot carries an
`<!-- screenshot: <file> — <what it shows> -->` marker at the exact spot the
image belongs. When you drop a file in here, replace that marker with:

```markdown
![Alt text describing what the shot shows, not the word "screenshot".](./images/<file>)
```

## Rules for every shot

- **Dark theme, default accent, one window size** across all of them. Mixed
  themes read as a broken product. The shots in place were taken at a 1496×933
  window; match it.
- **Real content**: use this repository as the demo project. It has real run
  scripts, a real `.ensemblr/settings.toml`, and real ADRs.
- **Scrub before saving**: no real Linear issue titles, no private repo names,
  no account email or organization name. `psoldunov` and the `/Users/psoldunov/…`
  paths are the maintainer's public handle and stay as they are; the Claude Code
  account block is pixelated in `11-settings-providers-claude.png` and must be
  pixelated in any reshoot.
- **Blur absolute filesystem paths.** `psoldunov` is the maintainer's public
  GitHub handle and stays visible in branch names and repository names, but a
  full `/Users/…` path is noise a reader cannot act on. Blurred in the six shots
  that showed one: the workspace path in the header of `06-chat.png`,
  `06-plan-mode.png`, `07-dock-run-scripts.png`, and `08-pr.png`; the root
  directory row in `03-root-directory.png`; the three executable and agent-directory
  paths in `11-settings-providers.png`. Do the same in any reshoot.
- macOS window chrome included; no desktop background, no menu-bar clock.
- Max width **1600px**, PNG, run through `oxipng` or `pngquant`. Budget: **200 KB
  per image, 3 MB for this directory.** The fourteen in place total 824 KB.
  Re-run both after editing an image — an unquantized re-save doubles its size.

### Processing a raw capture

A window capture is the window plus its drop shadow on a transparent canvas.
Crop to the opaque window rect, downscale, then quantize:

```sh
# find the opaque window rect in a fresh capture
magick shot.png -alpha extract -threshold 99% -format '%@' info:   # e.g. 2992x1866+112+76

magick shot.png -crop 2992x1866+112+76 +repage -resize 1600x -strip /tmp/step.png
pngquant --quality 60-92 --speed 1 --force --output <target>.png /tmp/step.png
oxipng -o 4 --strip safe -q <target>.png
```

A **screen** capture has no alpha, so that rect probe returns nothing and the
frame carries the menu bar and the wallpaper. Find the window edges by sampling
across them, crop to the same 2992×1866, and mask the corners back to
transparent so it matches the window captures:

```sh
magick shot.png -format '%[pixel:p{15,900}]' info:   # step x/y until the wallpaper ends

magick shot.png -crop 2992x1866+16+83 +repage \
  \( -size 2992x1866 xc:none -fill white -draw 'roundrectangle 0,0,2991,1865,22,22' \) \
  -alpha set -compose DstIn -composite -resize 1600x -strip /tmp/step.png
```

To pixelate a region — an account email, an org name — composite a downsampled
copy of it back over itself. Force the clone opaque, or a region overlapping the
window's shadow comes back semi-transparent and the text reads straight through:

```sh
magick shot.png \
  \( +clone -crop 400x44+2120+933 +repage -alpha off -resize 4% -resize 400x44! \) \
  -geometry +2120+933 -composite out.png
```

## The list

| File | Page | What it must show | Status |
| --- | --- | --- | --- |
| `00-hero-dashboard.png` | `README.md` | The dashboard board with workspaces across all five columns. The one shot people see before they read anything. | In place |
| `03-wizard-welcome.png` | `03-first-run.md` | The setup wizard's welcome screen: the language picker and one row each for an agent CLI, the GitHub CLI, and Linear. | In place |
| `03-wizard-agent-cli.png` | `03-first-run.md` | The agent CLI step with **one runtime satisfied and the other not** — Pi "Not installed", Claude Code "Ready", step green. The most misunderstood screen in the app. | In place |
| `02-settings-diagnostics.png` | `02-requirements.md`, `14-troubleshooting.md` | Settings → More → Diagnostics, the full rollup, with **one check not passing** so its remediation buttons are visible. The shot in place has the root directory on `Warning`. | In place |
| `03-root-directory.png` | `03-first-run.md` | Settings → General, the Ensemblr root directory row. | In place |
| `03-create-workspace.png` | `03-first-run.md` | The create-workspace dialog with all three source tabs visible (branch, pull request, issue). | In place |
| `05-create-workspace.png` | `05-workspaces.md` | The same dialog on the Branches tab, showing the row actions a branch another workspace already holds gets — *Open* and *Duplicate branch* — against a free branch that offers neither. | In place |
| `05-board.png` | `05-workspaces.md` | The board with cards in Backlog, In Progress, and In Review, and one card's action menu open. Do not reuse `00-hero-dashboard.png` — the open menu is the point. | **Outstanding** |
| `06-chat.png` | `06-agents.md` | The chat timeline with a tool card expanded, the model picker and the context gauge visible. | In place |
| `06-plan-mode.png` | `06-agents.md` | Plan mode active in the composer, with a submitted plan raised in the review panel. | In place |
| `07-dock-run-scripts.png` | `07-terminals-and-run-scripts.md` | The dock with a run script running **and** the run-script picker open, so the named scripts and their icons are legible. | In place |
| `08-changes.png` | `08-reviewing-changes.md` | The diff viewer with an inline review comment thread open. | **Outstanding** |
| `08-pr.png` | `08-reviewing-changes.md` | The Checks tab with the PR title and description editor filled in. | In place |
| `11-settings-providers.png` | `11-app-settings.md` | The Providers pane on the Pi tab, both runtimes listed, with the executable override control visible. | In place |
| `11-settings-providers-claude.png` | `11-app-settings.md` | The same pane on the Claude Code tab, for the Account block the Pi tab has no equivalent of. Account, organization, and the authentication line are pixelated. | In place |
| `13-shortcuts.png` | `13-keyboard-shortcuts.md` | Settings → More → Shortcuts, showing the scope groups. | In place |

## Shortcut: the playground

`npm run dev:playground` (or the `playground` run script) serves the real
components with neutral fixtures at `http://localhost:5199/`, with no private
data in them. Its `review → comment` and `review → pr header` scenes are close to
`08-changes.png` and `08-pr.png` — but they render without the app's own chrome,
so a shot from the real app is better wherever you can get one.
