# Code Review Policy

When the `code-review` skill is triggered, run automated diagnostics as its final step — after the functional review and after `bun run check` and `bun run typecheck`, and before reporting a change ready or opening a PR.

- Run the `react-doctor` skill on touched renderer or React code. It covers lint, dead code, accessibility, bundle size, and architecture diagnostics and includes a score regression check. Treat a score regression as a blocker; resolve flagged issues before finishing.
- Run `fallow` on the changed set (use `check_changed` or `audit`) to catch changed-code risk, unused code, duplication, circular dependencies, and complexity hotspots. Resolve each finding or explicitly justify why it stands.
- These diagnostics are additive, not a replacement for `bun run check` and `bun run typecheck`. Run those first.
- In the final response, state which tools ran and list any outstanding findings that were accepted rather than fixed.
