# Code Review Policy

When the `code-review` skill is triggered, run automated diagnostics as its final step — after the functional review and after `npm run check` and `npm run typecheck`, and before reporting a change ready or opening a PR.

- Run the `react-doctor` skill on touched renderer or React code. It covers lint, dead code, accessibility, bundle size, and architecture diagnostics and includes a score regression check. Treat a score regression as a blocker; resolve flagged issues before finishing.
- Run `fallow` on the changed set (use `check_changed` or `audit`) to catch changed-code risk, unused code, duplication, circular dependencies, and complexity hotspots. Resolve each finding or explicitly justify why it stands.
- Check comment discipline on the changed diff only. Every comment the diff adds must be a JSDoc block, a tool directive, or a *why*-comment meeting the criteria in `.claude/rules/comments.md`. Flag any comment that restates what the code says, any commented-out code, and any bare `TODO`/`FIXME`. Pre-existing comments outside the diff are out of scope — do not gate a review on them.
- Check translation completeness on the changed diff. Every catalogue key the diff adds must have a non-empty `ru` and `el` value, and a user-facing surface the diff touches must leave no hardcoded literal and no empty value behind — `npm run i18n:status` reports the per-locale numbers. See `.claude/rules/i18n.md`. Pre-existing gaps in files the diff does not touch are out of scope.
- These diagnostics are additive, not a replacement for `npm run check` and `npm run typecheck`. Run those first.
- In the final response, state which tools ran and list any outstanding findings that were accepted rather than fixed.
