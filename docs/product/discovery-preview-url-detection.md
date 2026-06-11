# Discovery: Preview URL Detection (ENS-041 / THE-141)

Status: discovery complete — recommendation below. 2026-06-11.

## Question

How should Ensemble surface a clickable preview URL for a workspace's running
dev server: by parsing setup/run script output, by expanding an explicit
repository preview URL template, or both?

## Context

- Run/setup scripts now execute in PTY sessions (ENS-036/038) and their output
  streams through the terminal dock.
- Every workspace gets a stable `ENSEMBLE_PORT` (and `CONDUCTOR_PORT` mirror)
  from workspace environment injection (ENS-039), so well-behaved repository
  run scripts can bind a predictable port.
- The repository settings resolution already carries a `previewUrlTemplate`
  built-in default (`null`) — the template pathway has a reserved key.

## Option A — log parsing (automatic detection)

Scan PTY output for URL-shaped tokens and promote the first plausible match to
the "Open preview" affordance.

Reliable patterns (observed in common dev servers):

| Server | Output line |
| --- | --- |
| Vite | `➜  Local:   http://localhost:5173/` |
| Next.js | `- Local:        http://localhost:3000` |
| webpack-dev-server | `Project is running at http://localhost:8080/` |
| Rails/Puma | `Listening on http://127.0.0.1:3000` |
| Phoenix | `Access YourApp.Endpoint at http://localhost:4000` |

A conservative matcher: `https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}(/\S*)?`
anchored to line boundaries after ANSI stripping.

Unsafe / false-positive patterns:

- Documentation links printed by tooling (`https://nextjs.org/docs`...) — any
  non-loopback host must never auto-promote.
- Proxy/tunnel URLs (`*.ngrok.io`, `*.trycloudflare.com`) — these are publicly
  reachable; auto-surfacing them invites accidental sharing.
- Multi-service scripts printing several ports (app + storybook + api) — "first
  match wins" picks arbitrarily.
- `0.0.0.0` binds — opening `http://0.0.0.0:PORT` fails in some browsers; must
  rewrite host to `localhost`.
- ANSI-wrapped and line-wrapped URLs split across PTY chunks — matching must
  run on reassembled lines, not raw chunks.

Privacy risks: log lines can embed absolute workspace paths and query tokens
(`?token=` dev-server auth). Any UI that echoes the matched line verbatim may
leak paths; the matched URL itself can carry one-time tokens that should not be
persisted.

## Option B — explicit preview URL template (repository config)

`previewUrlTemplate` in `ensemble.json` (e.g. `http://localhost:${ENSEMBLE_PORT}`),
expanded with the same workspace environment used for scripts. `CONDUCTOR_*`
names expand for compatibility repositories. Expansion is a pure string
substitution against the injected variable set — no log access at all.

Properties: deterministic, zero false positives, works before the server
prints anything, respects workspace isolation. Cost: requires one line of
repository config and a run script that honors `ENSEMBLE_PORT`.

## Recommendation

1. **v1 build scope: template-first.** Implement `previewUrlTemplate`
   expansion with `ENSEMBLE_*`/`CONDUCTOR_*` substitution and wire it to the
   dock "Open :port" affordance. Default template when unset:
   `http://localhost:${ENSEMBLE_PORT}` shown only while a run session is
   active.
2. **Defer automatic log parsing.** If accepted later, restrict to loopback
   hosts, strip ANSI, parse whole lines, never persist matched URLs, and offer
   it as opt-in. Tracked as a follow-up ticket (create on acceptance).
3. Never auto-open or auto-share detected URLs; user click only.

## Follow-ups

- Build ticket for template expansion + dock affordance (file under
  Milestone 5/8 polish when prioritized).
- Decision needed (product): whether loopback-only log parsing ships post-core.
