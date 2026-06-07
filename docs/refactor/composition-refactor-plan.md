# Composition & File Organization Refactor — Plan

Reference: Fernando Rojo, "Composition Is All You Need" (React Universe Conf 2025).

## Phase 1 — Inventory

Scanned `src/**/*.tsx` (68 files). Excluded vendored shadcn primitives in `src/renderer/components/ui/*` and route shells in `routing/routes/*` (small + already split).

### Feature files > 250 lines (and/or with prop-bloat)

| File | Lines | Exports | Internal PascalFn | Smells |
|---|---|---|---|---|
| `components/setup-diagnostics.tsx` | 822 | **4** | 6 | Four unrelated public components in one file |
| `workbench-shell/route-layout.tsx` | 779 | **5** | 2 | 5 exports; `renderStaticNavigationLink` / `renderWorkspaceNavigationLink` render-props; `isSetupDiagnosticsRetrying` flag drilled |
| `workbench-shell/checks-panel.tsx` | 652 | 1 | **14** | 14 sub-components; heavy `kind:` discriminated-union variant rendering |
| `workbench-shell/navigation-sidebar.tsx` | 520 | 1 | 6 | **7 render-prop entries** drilled through 5 layers (worst render-prop sprawl in the repo); `isActive`/`isCollapsed` booleans |
| `workbench-shell/review-files.tsx` | 500 | **3** | 7 | Three unrelated public components in one file (`ReviewFileList` + `AllFilesList` + `AllFilesSearchDialog`); `isCollapsed`/`showPath`/`open` flags |
| `workbench-shell/conversation-panel.tsx` | 448 | **3** | 5 | Three unrelated public components (`SessionTabs` + `WorkspaceTimeline` + `ComposerPanel`); `isSetupDiagnosticsRetrying` drilled |
| `workbench-shell/workspace-sidebar-item.tsx` | 408 | 1 | 4 | 5 boolean flags (`isActive`/`isPinned`/`isSpinning`/`isSelected`) + render-prop + 9 `kind:` variants |
| `workbench-shell/dock-panel.tsx` | 399 | 1 | 7 | 7 sub-components; manageable, but bulky |
| `workbench-shell/right-sidebar-header.tsx` | 387 | 1 | 3 | `kind: 'create-pr' \| 'empty'` + 5 `kind:` PR variants |
| `workbench-shell/project-sidebar.tsx` | 376 | **2** | 3 | Two unrelated public components (`ProjectCreationMenu` + `ProjectSidebarHeader`) |
| `components/workbench-shell.tsx` | 376 | **3** | 0 | Three exports; defines `WorkspaceMainContentState` shared type |
| `workbench-shell/create-workspace-source-dialog.tsx` | 320 | 1 | 3 | Borderline — leave |
| `workbench-shell/review-panel.tsx` | 299 | 1 | 3 | Borderline — leave |
| `workbench-shell/panel-layout.tsx` | 275 | **2** | 2 | **6 boolean flags drilled** (`isDockCollapsed`, `isRightSidebarCollapsed`, `isSetupDiagnosticsRetrying`) across two exports |
| `workbench-shell/workbench-header.tsx` | 194 | 1 | 2 | `isRightSidebarCollapsed` flag |

### Cross-cutting smell

`isDockCollapsed`, `isRightSidebarCollapsed`, `isSetupDiagnosticsRetrying`, `setupDiagnostics`, `setupDiagnosticsError`, `onSetupDiagnosticsRetry` are drilled from
`workbench-shell.tsx` → `route-layout.tsx` → `panel-layout.tsx` → (`workbench-header`, `conversation-panel`, `review-panel`, `dock-panel`). Same with `renderStaticNavigationLink`/`renderWorkspaceNavigationLink` from `route-layout.tsx` → `navigation-sidebar.tsx` → 5 sub-components.

This is the prop-drilling pattern the Rojo talk warns against; context (state/actions/meta) is the right answer.

## Phase 2 — Proposed shapes

### Composition principle applied per file

#### `setup-diagnostics.tsx` → folder
```
components/setup-diagnostics/
  index.ts                          # public barrel
  panel.tsx                         # SetupDiagnosticsPanel
  compact.tsx                       # SetupDiagnosticsCompact
  root-directory-change-dialog.tsx  # RootDirectoryChangeDialog + RootDirectoryChangeContent
  setup-check-row.tsx               # SetupCheckRow
  local-execution-notice.tsx
  root-path-preview.tsx             # + RootDirectoryDiagnostics + RootDirectoryApplyResult
  compact-metric.tsx
```
Behavior-preserving split. No API change.

#### `checks-panel.tsx` → folder, **compound component**
```
components/workbench-shell/checks-panel/
  index.ts            # export const ChecksPanel = Object.assign(Root, { Summary, Section, ... })
  checks-panel.tsx    # Root + context provider
  context.tsx         # ChecksPanelContext: state (kind variant), actions, meta
  summary.tsx         # ChecksPanel.Summary, ChecksPanel.SummaryIcon
  pr-rows.tsx         # PullRequestStatusRow, ChecksActionRow, PullRequestCheckRow,
                      # PullRequestPreviewDeploymentRow, PullRequestCommentRow, PullRequestTodoRow
  section-header.tsx
  empty-state.tsx
  icons.tsx           # PullRequestCheckStatusIcon, ProviderMark
```
Variants stop being a switch on `kind:`; the Root reads kind from context, sub-components only render when relevant. Consumer composes the rows it wants.

#### `navigation-sidebar.tsx` family — **context kills the render-props**
```
components/workbench-shell/navigation-sidebar/
  index.ts
  navigation-sidebar.tsx        # Root + context provider
  context.tsx                   # NavigationContext { state, actions: { renderLink }, meta }
  sidebar-primary-navigation.tsx
  static-navigation-item.tsx
  pinned-workspace-group.tsx
  project-navigation-groups.tsx
  project-workspace-group.tsx
  sidebar-health-footer.tsx
```
`renderStaticNavigationLink`/`renderWorkspaceNavigationLink`/`renderNavigationLink` (7 entries today) collapse into a single `renderLink` (or `LinkComponent`) on context. Sub-components pull it from `useNavigationContext()`. Removes ~7 drilled props.

#### `workspace-sidebar-item.tsx` — **kind union → sub-components**
```
components/workbench-shell/workspace-sidebar-item/
  index.ts
  workspace-sidebar-item.tsx    # Root
  diff-stats.tsx                # WorkspaceDiffStats + status variants
  status-badges/                # one file per kind: workspace-blocked/working/checking + pr-ready/checking/blocked/working
  context-menu.tsx              # WorkspaceContextMenuContent + WorkspaceStatusMenuItem + SidebarContextMenuItem
```
`isActive`/`isPinned`/`isSpinning`/`isSelected` move to context where the consumer arranges via slots.

#### `route-layout.tsx` — split exports, kill drilled render-props
```
components/workbench-shell/route-layout/
  index.ts
  workbench-shell-layout.tsx
  workbench-placeholder-page.tsx
  workspace-workbench-layout.tsx
  workspace-chat-page.tsx
  workspace-no-chat-page.tsx
  workspace-route-content.tsx
  workspace-main-content-outlet.tsx
```
`renderStaticNavigationLink`/`renderWorkspaceNavigationLink` removed in favour of `NavigationSidebar` context (see family above).

#### `review-files.tsx` — split 3 unrelated public components
```
components/workbench-shell/review-files/
  index.ts
  review-file-list.tsx        # + ReviewFileTree, ReviewDirectoryBranch, ReviewFolderRow, ReviewFileButton, ReviewFilePath, ReviewFileStats
  all-files-list.tsx
  all-files-search-dialog.tsx
  workspace-file-icon.tsx     # shared
```

#### `conversation-panel.tsx` — split 3 unrelated public components
```
components/workbench-shell/conversation-panel/
  index.ts
  session-tabs.tsx            # + ClosedSessionHistoryMenu
  workspace-timeline.tsx      # + AgentChatThread, ChatMessage, ChatAvatar, ChatToolList
  composer-panel.tsx
```

#### `dock-panel.tsx` — folder split (keep single export, decompose internals)
```
components/workbench-shell/dock-panel/
  index.ts
  dock-panel.tsx              # Root
  actions.tsx                 # DockPanelActions
  setup-script-output.tsx
  run-script-output.tsx
  log-output.tsx
  interactive-terminal.tsx
  script-empty-state.tsx
  read-only-command-output.tsx
```

#### `right-sidebar-header.tsx` — folder split
```
components/workbench-shell/right-sidebar-header/
  index.ts
  right-sidebar-header.tsx
  pull-request-number-button.tsx
  preview-deployment-button.tsx
  create-pull-request-menu.tsx
```

#### `project-sidebar.tsx` — split 2 unrelated public components
```
components/workbench-shell/project-sidebar/
  index.ts
  project-creation-menu.tsx
  project-sidebar-header.tsx
  project-context-menu.tsx    # ProjectContextMenuContent + ProjectContextMenuItem + ProjectHeaderActionButton
```

#### `workbench-shell.tsx` — separate frame, content, shared type
```
components/workbench-shell.tsx     # remains as barrel re-exporting:
components/workbench-shell/frame.tsx              # WorkbenchFrame
components/workbench-shell/workspace-content.tsx  # WorkspaceWorkbenchContent
components/workbench-shell/types.ts               # WorkspaceMainContentState type
```

#### `panel-layout.tsx` — context for layout flags
Introduce **`WorkbenchLayoutContext`** owning `isDockCollapsed`, `isRightSidebarCollapsed`, dock/right-sidebar imperative refs, and a separate `SetupDiagnosticsContext` owning `setupDiagnostics`, `setupDiagnosticsError`, `isSetupDiagnosticsRetrying`, `onSetupDiagnosticsRetry`.

Drops boolean flags from `WorkbenchPanelLayout`, `WorkspaceConversationContent`, `WorkbenchHeader`, `WorkbenchDockActions`, `MainWorkspacePanel`, `ReviewDockPanel`, `ReviewPanel`, `ConversationPanel`. Consumers read from context.

## Phase 2 — Partition

Two unit kinds:

**Cross-cutting (orchestrator only):**
- C1. Introduce `WorkbenchLayoutContext` + `SetupDiagnosticsContext` (new files; shared barrels).
- C2. Introduce `NavigationContext` shared by navigation-sidebar family (new file).
- C3. Final shared `types.ts` cleanup (re-exports for `WorkspaceMainContentState`).
- C4. Integration sweep: remove drilled props from `workbench-shell.tsx` / `route-layout.tsx` / `panel-layout.tsx` consumers.

**Independent units (parallel subagents — each owns isolated files):**

| Unit | Owns (files, including new) | Touches outside? |
|---|---|---|
| U1 setup-diagnostics | `components/setup-diagnostics.tsx` → folder split | None (pure split) |
| U2 checks-panel | `workbench-shell/checks-panel.tsx` → folder | None |
| U3 review-files | `workbench-shell/review-files.tsx` → folder | None |
| U4 conversation-panel | `workbench-shell/conversation-panel.tsx` → folder | Reads `SetupDiagnosticsContext` (created by C1) |
| U5 dock-panel | `workbench-shell/dock-panel.tsx` → folder | None |
| U6 right-sidebar-header | `workbench-shell/right-sidebar-header.tsx` → folder | None |
| U7 project-sidebar | `workbench-shell/project-sidebar.tsx` → folder | None |
| U8 workspace-sidebar-item | `workbench-shell/workspace-sidebar-item.tsx` → folder | Reads `NavigationContext` (created by C2) |
| U9 navigation-sidebar | `workbench-shell/navigation-sidebar.tsx` → folder | Reads `NavigationContext` (created by C2); coordinated with C4 |

**Order of execution:**
1. Orchestrator does C1 + C2 + C3 (creates contexts and shared types).
2. Dispatch U1–U7 in parallel (truly isolated).
3. Dispatch U8, U9 (depend on C2).
4. Orchestrator does C4 integration sweep.
5. Verify.

## Guardrails reaffirmed
- Behavior-preserving. No accessibility or runtime change.
- Public exports kept stable via barrel re-export from the original module path (`setup-diagnostics.tsx` etc. remain as one-line barrels) so existing imports still resolve. Then optionally migrate call sites in a follow-up.
- shadcn `components/ui/*` left alone (vendored).
- No new manual memo (project uses React 19 — verify whether React Compiler is on; if not, do not add).
- One concern per change.

## Open questions for approval
1. Is the surface size acceptable (≈14 feature files touched, ~6300 lines refactored)?
2. Keep original module paths as one-line barrels (back-compat shim) or migrate call sites in the same change?
3. Verify React Compiler status — affects whether new code may use manual memoization.
