# 0075. Let the User Vouch for Read-Only Tools

Date: 2026-09-21

## Status

Accepted

## Context

Plan Mode and the Concierge both refuse any tool call they can't vouch for.
The Pi extension sends every tool name it doesn't already know to be a read
over to the app. The app clears a short list of each runtime's built-in reads
plus Ensemblr's own control tools, and refuses everything else. That default
exists because the tool set a session holds is open-ended: the user can install
another extension or point a runtime at an MCP server, and one of those can
write a file as easily as `write` does. `powershell` and an MCP `write_file`
reached a supposedly read-only Concierge before the default was flipped to
deny.

The price of that default is paid by the reads nobody listed. Pi has no web
tool of its own, so a Pi Concierge asked whether a build exists came back with
`web_search` refused. A Claude Concierge answers the same question with its
built-in `WebSearch`. A Pi user runs whatever extensions they chose and a
Claude user whatever MCP servers they configured. The app can't list those
tools ahead of time, and it can't tell which of them only read. Pi's
`ToolDefinition` has no read-only or side-effect field. MCP's `readOnlyHint`
is set by the server about itself, so it's a claim, not a guarantee.

## Decision

The user vouches for tools; the app only asks.

- **One list per runtime, owned by the user.** `providers.piReadOnlyTools` and
  `providers.claudeReadOnlyTools` in `~/.config/ensemblr/config.json`, edited
  under Settings → Providers → Read-only tools. There's one list per runtime
  rather than per policy. Plan Mode and the Concierge ask the same question
  about a tool they don't know, so each runtime's list answers both. Tool
  names differ per runtime, and so does the inventory the list is picked from.
- **The list widens only the default denial.** Each guard checks it last, after
  its write and shell rules. A trusted `bash` still goes through the bash
  classifier, and a trusted `write` still goes through the path check.
  `toTrustedToolSet` also removes, before any guard sees the list, every name
  a policy already covers. It removes `powershell` too. It removes
  `pi-mcp-adapter`'s `mcp` and `mcpScript` dispatchers as well: their
  arguments decide what they call, so trusting the name would trust every tool
  behind it.
- **On Claude Code, only an MCP tool can be trusted.** Claude's own built-in
  tools are for the app to classify, not the user. The read-only ones are
  already cleared. The rest take actions: `Monitor` runs a command the bash
  classifier never sees, `EnterWorktree` changes git, and `Workflow` starts
  agents that write. A switch must not be able to clear any of them. What a
  Claude session has beyond its built-ins comes over MCP, so the Claude list
  accepts only `mcp__<server>__<tool>` names. Every other name is dropped from
  the inventory, the refusals and the saved list.
- **Agents can read the list but can't change it.** Both keys are left out of
  the agent-control settings patch. The Concierge edits app settings without a
  dialog when the user is away, and if it could patch these lists it could
  grant itself a writer.
- **The app offers what the runtimes report.** The Pi extension sends
  `pi.getAllTools()` over the internal `reportToolInventory` op whenever the
  list changes. Claude Code's list comes from the SDK's `init` message. The
  inventory is kept in memory and rebuilt from the first session each runtime
  opens, because a saved one would keep offering tools the user has since
  uninstalled. A tool the Concierge, or Plan Mode on Pi, has refused since
  launch gets a badge until the user trusts it. Claude Code's own plan mode
  refuses a tool inside the CLI, where the app never sees it, so those tools
  get no badge. A refusal message tells the model where the setting is, so it
  can point the user there.
- **Tools the app knows are safe are cleared without a setting.** Both policies
  clear `pi-web-access`'s `web_search`, `fetch_content`, `get_search_content`
  and `source_check`. Their output goes to Pi's cache or a temp directory, and
  none of them takes a parameter that could point it into a workspace.
- **On Claude Code, a trusted tool is pre-approved only where the CLI would
  otherwise refuse it.** That means while the chat is planning, and never
  under `approval-required`, where the user's own approval card is the gate.
  This is the same rule the control tools already follow.

## Rejected alternatives

- **A config file on the Pi side.** Enforcement lives in the app, and the
  extension asks the app for every call. A list read by the extension would be
  a second authority, and it would cover Pi only.
- **A key in `.ensemblr/settings.toml`.** The tools installed are a property of
  the machine, not the repository. A committed key would also let a cloned
  repository widen the tool policy for an agent working in it.
- **An "Always allow" button on the refused tool card.** The renderer receives
  the refusal only as the tool's English error text. Recognising it would mean
  matching that prose, or passing a refusal code through both runtimes' event
  streams. The Settings badge and the refusal text pointing to the setting get
  the same result without that coupling.
- **Classifying tools automatically.** Neither runtime has a field that could
  be trusted for it.

## Consequences

- Trust is by name. A tool from another package with the same name gets the
  same clearance. The inventory shows each tool's source so the user can see
  what they're trusting. The UI warns that a trusted tool must not change
  files, run commands, or act on the user's accounts. This is also why the
  web tools are cleared by name and not keyed to the package that registers
  them. A Pi extension runs inside Pi's process with full authority, so a
  hostile one needs no tool call to do harm, and a source check would stop
  nothing. It would, however, break a user who installs `pi-web-access` from
  git or a local path.
- The lists hold back agents that are restricted now. They are not a barrier
  against an agent that already has a shell. The Concierge and a planning
  session can't write `config.json`: their writes are confined or refused,
  and their `bash` is limited to reads. A session with an unrestricted shell
  could edit the lists directly, or send `reportToolInventory` with its
  control token to put a misleading row in the Settings list. Neither gives it
  anything its shell didn't already have, and a planted row changes no policy
  until the user switches it on.
- A Pi per-server MCP wrapper, `mcp__<server>`, can be trusted, and that
  trusts the whole server. For finer control the user registers the server's
  tools directly with the adapter's `directTools`.
- A tool registered after the inventory report shows up once the next turn
  reports it. The add-by-hand field covers a tool that hasn't been reported
  yet.
