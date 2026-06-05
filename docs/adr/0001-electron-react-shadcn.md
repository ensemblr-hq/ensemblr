# 0001. Use Electron, React, and shadcn/ui for the Desktop App

Date: 2026-06-04

## Status

Accepted

## Context

Ensemble is a macOS desktop workbench for Pi coding-agent workflows. The app needs to manage local repositories, git worktrees, long-running Pi sessions, project commands, review flows, and native desktop affordances such as a macOS menu bar.

The primary maintainer is strongest in React and TypeScript and wants to avoid making Xcode and SwiftUI expertise a core maintenance requirement.

Pi exposes integration modes suitable for desktop apps, including `pi --mode rpc` over stdin/stdout JSONL. Ensemble uses that CLI RPC boundary for v1 so users can run the same Pi runtime or compatible wrapper they use in the terminal.

## Decision

Build Ensemble as an Electron app with:

- Electron main process for native app lifecycle, macOS menu bar, local process management, git/filesystem access, and Pi agent runtime orchestration.
- React and TypeScript renderer for the user interface.
- shadcn/ui as the renderer component foundation.
- Tailwind CSS and project-owned design tokens for a compact, macOS-inspired developer-tool interface.

shadcn/ui will be treated as owned source code copied into the project, not as a black-box component dependency. Electron will provide native shell capabilities; shadcn/ui will provide in-window UI primitives and composition.

## Alternatives Considered

### SwiftUI

SwiftUI would provide the most native macOS UI and first-class platform behavior, but it would require Swift, SwiftUI state management, Xcode workflows, and native process supervision to become core project skills. That conflicts with the maintainer's React/TypeScript strengths.

### Tauri

Tauri would keep the renderer in React/TypeScript and produce smaller binaries, but the backend would be Rust. Tauri would likely require either a Node sidecar or a subprocess-only RPC bridge while still adding Rust desktop plumbing.

### Electron without shadcn/ui

A fully custom React UI would maximize control, but would slow down early product development. Ensemble needs many standard desktop controls: dialogs, menus, popovers, forms, resizable panes, tabs, command palettes, tooltips, and tables.

### macOS-themed React libraries

macOS-themed React kits can help with inspiration but are too risky as core dependencies unless they prove long-term maintenance, accessibility, and component coverage. Ensemble should own its design system rather than depend on a cosmetic macOS clone library.

## Consequences

- The project can be developed and maintained primarily with React, TypeScript, Node, and CSS.
- The app can use Electron's native menu APIs for the macOS menu bar while rendering the main interface with React.
- The app can supervise the selected Pi CLI RPC process while keeping the runtime boundary abstract enough to move to a sidecar or SDK host later.
- The app will not have true AppKit-native controls inside the content area.
- The app must intentionally avoid stock shadcn dashboard aesthetics and define a compact, Mac-like product style.
- Electron's larger runtime footprint is accepted in exchange for lower implementation risk and faster iteration.
