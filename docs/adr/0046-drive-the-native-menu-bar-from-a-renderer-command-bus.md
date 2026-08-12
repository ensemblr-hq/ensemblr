# 0046. Drive the Native Menu Bar From a Renderer Command Bus

Date: 2026-08-12

## Status

Accepted

Supersedes the ad-hoc `closeActiveTab` broadcast introduced with the
context-aware ⌘W close action (`695de4f`, #69), which is removed by this change.

## Context

The macOS menu bar is built by Electron in the main process, but almost
everything a menu item does belongs to the renderer: closing the active chat
tab, toggling the dock, focusing a review panel, opening the workspace this
window is looking at. Main knows none of that state.

Until #264 there was exactly one item wired this way. `ensemblr:close-active-tab`
was a one-off broadcast: main sent it, the renderer listened, and whether
anything was actually listening was unknowable — so the item was permanently
enabled and a click into a window with no tab open did nothing. That is
tolerable for one item. It does not scale to a real menu bar, and the bar was
six menus with most of the standard items missing.

Three constraints shape what a general version can look like:

1. **Only the renderer knows whether a command is live.** "Close Tab" is
   meaningful in a workspace with an open chat tab and meaningless on the
   dashboard. Main cannot compute that, and an item that is enabled but inert
   is worse than a disabled one, because the user reads the click as a bug.
2. **Some submenus are data, not structure.** The list of open workspaces, the
   list of run scripts, the recent projects — the entries come from renderer
   state and change while the app runs.
3. **A menu rebuild is not free and is visible.** `Menu.setApplicationMenu`
   replaces the whole bar. Rebuilding on every renderer render would flicker
   and would drop an open menu out from under the pointer.

## Decision

### 1. One command table in `src/shared/`

`src/shared/menu-commands.ts` holds the `MenuCommandId` union, the shape of the
context the renderer reports, and `areMenuContextsEqual`. Both processes import
it, so a command cannot exist on one side and not the other, and neither side
owns the vocabulary.

### 2. The renderer reports, main enables

The renderer sends a `MenuContext` over `menuContext`: which command ids
currently have a handler, plus the entries filling the dynamic submenus. Main
builds the bar from that report — an id absent from it produces a disabled item —
and dispatches a click back over `menuCommand`.

Rebuilds are gated on `areMenuContextsEqual`. A report that does not change the
menu does not rebuild it, which is what makes it safe for the renderer to report
on every relevant state change rather than trying to decide when a report is
worth sending.

### 3. Handlers register as a per-command stack

`src/renderer/state/menu-commands/` registers a handler per command as a
**stack**, not a slot. Route transitions overlap — the arriving route mounts
before the leaving one unmounts — so a slot would let the departing component's
cleanup clear the arriving component's handler and leave the command dead. A
stack pops the registration that is actually leaving and restores the one
underneath.

### 4. One builder per menu behind a factory

`src/main/menu/application-menu.ts` keeps its role as the composer and delegates
each menu to its own builder: `app-menu.ts`, `file-menu.ts`, `edit-menu.ts`,
`view-menu.ts`, `chat-menu.ts`, `workspace-menu.ts`, `changes-menu.ts`,
`window-menu.ts`, `help-menu.ts`. `createMenuItemFactory` (`menu-item.ts`) owns
the three things every item does the same way: resolving enabled state from the
reported context, resolving checked state, and attaching an accelerator.

Labels come from `menu-strings.ts`, the one main-process string catalogue. It is
a deliberate exception to the rule in `.claude/rules/i18n.md` that main returns
locale-neutral codes and the renderer owns the wording: the bar is built before
any renderer exists, and thirty static labels do not justify booting i18next in
the main bundle. A new menu item adds `en`, `ru`, **and** `el` to that table.

### 5. An accelerator belongs to exactly one owner

A command carries an `ownsAccelerator` flag, and only a command that sets it
gets a key equivalent on its menu item.

This is not a stylistic choice. On macOS, AppKit matches a menu item's key
equivalent **before** the keystroke reaches the web contents. An item that
displays a shortcut also claims it. Electron exposes `registerAccelerator: false`
to display without claiming — and that option is documented as Windows/Linux
only, so on the one platform Ensemblr targets there is no display-without-
claiming option at all.

The consequence is that composer- and dialog-scoped chords carry no menu
accelerator. `CommandOrControl+Return` is four different submits — send a
message, submit a plan, confirm a dialog, approve a tool call — that only the
renderer's layered key handling can tell apart. Surfacing it in a menu would
route all four through one handler.

### 6. `tab.close` is always reported available

`tab.close` is the exception: it is reported live whether or not a handler is
registered. A disabled menu item **swallows** its accelerator rather than letting
it fall through, so a disabled Close Tab item would mean ⌘W does nothing in a
window with no tab — instead of closing the window, which is what the user
expects and what the fall-through gives them.

## Consequences

- **Adding a menu item is a four-step change**: an id in
  `src/shared/menu-commands.ts`, a label in `src/main/menu/menu-strings.ts` (all
  three languages), an entry in the relevant builder under `src/main/menu/`, and
  a `useMenuCommand` registration in the renderer surface that owns the action.
  Skipping the last one yields a permanently disabled item, which is the correct
  failure — it is visible, and it is not a lie.
- **The renderer is the source of truth for enablement.** A command that should
  grey out does so by unregistering, not by main inspecting app state. Main
  holds no product logic about when an action is possible.
- **A chord that lives in a menu cannot also be layered.** If a keystroke has to
  mean different things on different surfaces, it does not get an accelerator —
  it gets renderer key handling and, at most, a menu item with no shortcut
  displayed.
- **The bundled product roadmap left the Help menu** and `extraResource` with
  this change. It was a shipped copy of a planning document, and the menu is the
  only reason it was packaged at all.
