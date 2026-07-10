# 0022. Limit Open Chat Tabs to Five

Date: 2026-06-04

## Status

Accepted

## Context

Conductor supports multiple open chat tabs in a workspace. The screenshot review and user observation indicate Conductor allows five open chat tabs. Document previews are separate and do not count against the chat-tab limit.

Ensemblr should match this behavior for Conductor parity and to avoid unbounded Pi session/UI resource usage.

## Decision

Ensemblr will allow up to five open chat tabs per workspace.

Rules:

- Only chat tabs count toward the five-tab limit.
- Document previews, file previews, diffs, and other non-chat preview tabs do not count.
- Additional existing Pi sessions can remain in history and be reopened by closing another chat tab first.
- The UI should make the limit clear when the user attempts to open a sixth chat tab.

## Consequences

- Ensemblr matches observed Conductor tab behavior.
- Memory and Pi session UI resource usage are bounded.
- The workspace data model must distinguish chat tabs from preview tabs.
- The active Pi session history may contain more sessions than are currently open as tabs.
