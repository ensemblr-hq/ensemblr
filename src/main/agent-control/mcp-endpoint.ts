/**
 * MCP (streamable HTTP) surface over the agent-control service, for every caller
 * that speaks MCP rather than the Pi extension protocol: third-party harnesses
 * (Claude Code, Codex, Mistral Vibe) and first-class runtimes wired to the same
 * loopback server. Each tool forwards to {@link AgentControlService.invoke} with
 * the per-request bearer token, so the service remains the single
 * validation/scope/permission authority. Stateless: a fresh server + transport
 * per request (no sessions), token read from the request's Authorization header
 * by the caller.
 *
 * The tool list and the playbook are both cut to the caller. A harness owns a
 * terminal tab that titles itself from its own session log, so the four chat-tab
 * ops have nothing there to act on and the service refuses them; a spawned
 * sub-agent loses the delegation surface it is refused on top of that. Listing a
 * tool the service would only refuse teaches the model to keep reaching for it,
 * which is why {@link withheldControlOps} answers both axes in one place rather
 * than each bridge inventing its own answer.
 *
 * A call that blocks on a human — `askUserQuestion` above all — is held open for
 * as long as the user takes, so each one beats a progress notification while it
 * waits and carries the caller's abort signal down into the service. Without the
 * signal a client that gave up leaves its question on screen for a user to
 * answer into a void; with it, the dialog is withdrawn the moment nobody is
 * listening.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type ZodRawShape, z } from 'zod';

import {
	type AgentControlOp,
	type AgentControlResult,
	ARCHITECTURE_DIAGRAM_LIMITS,
	ASK_USER_QUESTION_LIMITS,
	awarenessForAudience,
	CONCIERGE_MESSAGE_LIMITS,
	CONCIERGE_MESSAGE_REASONS,
	type ControlAudience,
	EXIT_PLAN_MODE_LIMITS,
	LINEAR_AGENT_LIMITS,
	SET_SUMMARY_LIMITS,
	WORKSPACE_BOARD_STATUSES,
	withheldControlOps,
} from '../../shared/agent-control.ts';
import {
	ARCHITECTURE_LAYOUT_MAX_COLS,
	MAX_COMPONENT_SOURCES,
} from '../../shared/architecture-diagram.ts';
import type { AgentControlService } from './agent-control-service.ts';
import { withProgressHeartbeat } from './mcp-progress.ts';

/** One MCP tool: its client-facing name, the control op, help text, and args. */
export interface McpToolDef {
	name: string;
	op: AgentControlOp;
	description: string;
	shape: ZodRawShape;
}

const startStop = z.enum(['setup', 'run']);

/** One `askUserQuestion` choice, mirroring the shared questionnaire schema. */
const askOption = z.object({
	label: z.string().max(ASK_USER_QUESTION_LIMITS.maxLabelLength),
	description: z.string().optional(),
});

/** One question in an `askUserQuestion` call, with its two-to-six choices. */
const askQuestion = z.object({
	question: z.string(),
	header: z.string().optional(),
	options: z
		.array(askOption)
		.min(ASK_USER_QUESTION_LIMITS.minOptions)
		.max(ASK_USER_QUESTION_LIMITS.maxOptions),
	multiSelect: z.boolean().optional(),
});

/**
 * The architecture IR as the tool *advertises* it.
 *
 * It has to be spelled out rather than left as `z.unknown()`: an untyped
 * property serializes to an empty JSON Schema, and a client with nothing to aim
 * at sends the document as a JSON string — which then fails validation on the
 * far side, every time, with no hint that the encoding was the problem.
 *
 * Every object here is loose, so an archify document carrying brand marks or
 * guided views survives the trip intact rather than being stripped down to what
 * this shape happens to name. `architectureIrSchema` in `shared/` stays the
 * authority: this one only has to make the argument's *shape* legible.
 */
const architectureDiagram = z.looseObject({
	meta: z.looseObject({ title: z.string(), subtitle: z.string().optional() }),
	components: z
		.array(
			z.looseObject({
				id: z.string(),
				type: z.enum([
					'frontend',
					'backend',
					'database',
					'cloud',
					'security',
					'messagebus',
					'external',
				]),
				label: z.string(),
				sublabel: z.string().optional(),
				row: z.number().int().optional(),
				col: z.number().int().optional(),
				sources: z
					.array(z.looseObject({ path: z.string() }))
					.max(MAX_COMPONENT_SOURCES)
					.optional(),
			}),
		)
		.max(ARCHITECTURE_DIAGRAM_LIMITS.maxComponents),
	connections: z
		.array(
			z.looseObject({
				id: z.string().optional(),
				from: z.string(),
				to: z.string(),
				label: z.string().optional(),
				variant: z
					.enum(['default', 'emphasis', 'security', 'dashed'])
					.optional(),
			}),
		)
		.max(ARCHITECTURE_DIAGRAM_LIMITS.maxConnections)
		.optional(),
	boundaries: z
		.array(
			z.looseObject({
				kind: z.enum(['region', 'security-group']),
				label: z.string(),
				wraps: z.array(z.string()),
			}),
		)
		.max(ARCHITECTURE_DIAGRAM_LIMITS.maxBoundaries)
		.optional(),
	layout: z
		.looseObject({
			mode: z.enum(['grid', 'organic']),
			cols: z
				.number()
				.int()
				.min(1)
				.max(ARCHITECTURE_LAYOUT_MAX_COLS)
				.optional(),
		})
		.optional(),
	schemaVersion: z.number().int().optional(),
});

/**
 * What the tool actually accepts: the advertised object, or the JSON string a
 * client that could not read the advertisement sent instead.
 *
 * The string arm is what makes the two bridges answer the same way. The Pi
 * extension declares this argument `Type.Unknown()`, so a stringified document
 * reaches `decodeSubmittedDiagram` and is decoded; without the union the SDK
 * rejects the identical call here with a raw Zod error before the port is ever
 * entered — and this is the bridge whose clients are likeliest to stringify.
 * The tolerance is kept rather than dropped because the encoding is the bridge's
 * mistake and the document is right: refusing it sends a model rewriting content
 * that was never the problem.
 */
const submittedArchitectureDiagram = z.union([architectureDiagram, z.string()]);

/**
 * Every tool this endpoint knows how to serve, in the whole control vocabulary
 * rather than one audience's slice of it — {@link toolDefsFor} cuts it down per
 * caller. Input shapes are advisory for the client; the service re-validates
 * authoritatively.
 *
 * Exported so the parity test can hold each description against the Pi
 * extension's copy: the two registration sites cannot share a module (the
 * extension runs outside the app bundle), and these strings carry behaviour —
 * `stat=true FIRST` is the only thing stopping a model from pulling a whole
 * workspace diff it did not need.
 */
export const TOOL_DEFS: readonly McpToolDef[] = [
	{
		name: 'ensemblr_spawn_chat_tab',
		op: 'spawnChatTab',
		description: 'Open a new empty chat tab in the current workspace.',
		shape: { title: z.string().optional() },
	},
	{
		name: 'ensemblr_start_conversation',
		op: 'startConversation',
		description:
			"Open a fresh chat tab (or reuse one via chatTabId) and start a conversation. A chat tab spawns children on its own agent runtime and may omit `model` to inherit the model the app holds for it — on a runtime driven over MCP that is the model its last turn ran on, not one switched inside the runtime since. A caller with no runtime the app can name, and one whose own model it cannot name either, must pass a `model` from ensemblr_list_models: it is refused without one rather than opened on a default nobody chose. Pass a short, descriptive title to name the tab it opens. Brief it with what to deliver, not just what to look at: the question it answers, the defaults it should assume rather than come back and ask about, and whether it reports inline (the default) or writes a file at a path you name. Set wait=true to block until it finishes. Set peer=true ONLY when the user asked in so many words for a second orchestrator in this workspace: it opens a full root orchestrator alongside you rather than a sub-agent, with its own delegation budget, and the app asks the user to confirm it whatever the permission mode — passing it is stating an intent, not establishing authority. A peer needs a `title` and refuses `wait`: it is not a child to wait on, it outlives your turn, and you do not close its tab. Two orchestrators per workspace is the limit, because they share one worktree and one git index and nothing arbitrates a third writer; you remain the committer for both, and the app tells the peer so. planMode and afkMode state the mode the conversation opens in, and both belong to the Concierge alone: every other caller passes its own mode down and is refused these. planMode=true opens it planning, so it comes back with a plan for the user to approve. afkMode=true opens it unattended, which is for when the user has said they are stepping away — its question tool is refused, its permission confirmations are auto-approved, and a change it is asked to make runs through plan, review, and a pull request without stopping. It therefore refuses `wait` for the reason a peer does: the run outlives your turn and no wait window covers it. The two modes are opposites and cannot both be passed. Choose `thinkingLevel` deliberately rather than letting the child inherit yours: the lowest rungs for mechanical work, the middle for ordinary implementation and for reading code to answer a question, the high rungs for design, for diagnosing something that does not reproduce, and for reviewing work you will rely on. ensemblr_list_models publishes each model's ladder — the two runtimes do not share one, and a level from the wrong ladder is refused by name rather than quietly dropped. Naming a `model` that ensemblr_list_models reports as tier `frontier` is put to the user for confirmation whatever the permission mode, because it costs several times what the rest do; omitting `model` inherits yours and is never confirmed.",
		shape: {
			afkMode: z.boolean().optional(),
			chatTabId: z.string().optional(),
			peer: z.boolean().optional(),
			planMode: z.boolean().optional(),
			prompt: z.string(),
			model: z.string().optional(),
			thinkingLevel: z.string().optional(),
			title: z.string().optional(),
			wait: z.boolean().optional(),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_start_review',
		op: 'startReview',
		description:
			"Open this workspace's Review conversation over the change you have made — the same review the user's Review button runs, deferring to whatever review skill this repository ships, carrying the user's own review instructions, on the model they picked for reviews. Use it when a change is ready for a second reader, and prefer it to reviewing your own work: a reviewer that did not write the code is the whole point. What it opens is a root orchestrator with its own delegation budget, not your child, so it can spawn its own readers over a wide diff — which also means ensemblr_wait_for_agents will not pick it up by default and you must name its agentSessionId in `targets`. It shares this worktree with you: leave the files alone while it works. When it reports, send its findings back to the SAME conversation with ensemblr_send_follow_up and have it fix them there; you stay the committer and you own the pull request. Pass a short `title` when this is not the workspace's only review. It costs one of the workspace's two co-tenancy slots, so a workspace already holding a peer orchestrator or a running harness terminal refuses it.",
		shape: { title: z.string().optional() },
	},
	{
		name: 'ensemblr_send_follow_up',
		op: 'sendFollowUp',
		description:
			'Send a follow-up prompt into a conversation that is already running, whichever runtime it is on — not necessarily a child you spawned. Pass the `agentSessionId` that opening the conversation returned, not your own. Steering a conversation whose chat tab was closed puts that tab back in the tab strip, so the turn you asked for streams where the user is looking instead of into closed history.',
		shape: {
			agentSessionId: z.string(),
			prompt: z.string(),
			wait: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_set_name',
		op: 'setName',
		description:
			'Set a short, descriptive title for your own conversation tab so it is easy to identify. The label goes in `title`, the same key ensemblr_start_conversation names a tab with. This is the tab label, not the workspace or branch name — ensemblr_set_branch_name owns that.',
		shape: { title: z.string() },
	},
	{
		name: 'ensemblr_set_branch_name',
		op: 'setBranchName',
		description:
			'Name the work: renames this workspace AND its git branch together from one kebab-case slug (2-5 words, e.g. "add-dark-mode") passed as `name`, keeping any `prefix/` segment of the current branch. Call it once, early, as soon as you know what the work is called. It applies while the git branch still carries the name it was cut with; a workspace the user has already titled keeps that title and only its branch moves. A reply saying nothing changed is a settled outcome, not a fault to retry — except when the USER asks for a different branch name in so many words, which is what userRequested: true is for. Renaming the branch any other way, `git branch -m` included, desyncs the workspace from git. This names the workspace and branch, not your terminal tab, which titles itself from your own session log.',
		shape: { name: z.string(), userRequested: z.boolean().optional() },
	},
	{
		name: 'ensemblr_set_summary',
		op: 'setSummary',
		description: `Record the session summary the app keeps for this chat tab, replacing whatever is on file. Call it once the turn's work is done: \`title\` is a short topic line of at most ${SET_SUMMARY_LIMITS.maxTitleLength} characters and \`summary\` is markdown of at most ${SET_SUMMARY_LIMITS.maxSummaryLength}, covering the decisions made, the files touched, and what is still open. Either one over its limit is stored truncated rather than rejected, and the result says what was cut — so a long summary costs you the tail of it, never the whole call. Writing it yourself is what keeps the record useful — the app's fallback only dumps the raw transcript. This does NOT rename the tab.`,
		// The limits are named in the description, not declared on the shape: a
		// client that validates its own inputs would reject an over-long summary
		// locally, which is exactly the lost record the truncation exists to prevent.
		shape: { title: z.string(), summary: z.string() },
	},
	{
		name: 'ensemblr_get_architecture_diagram',
		op: 'getArchitectureDiagram',
		description:
			"Read this workspace's architecture diagram — directories as nodes, cross-module imports as edges, top-level directories as boundary frames. Call this FIRST, before ensemblr_update_architecture_diagram, so you edit the stored document rather than replacing it blind. `diagram` comes back null when nobody has drawn this workspace yet: that is an ordinary answer rather than a failure, and it is not something to retry. Nothing in Ensemblr derives a diagram — there is no scanner to invoke and nothing to look for on disk or in the app's database — so a null answer means you read the codebase and author one yourself, then store it with ensemblr_update_architecture_diagram. A workspace whose stored file cannot be parsed is refused rather than written over, and the refusal names what is wrong with it: that file is tracked, so repair or delete it rather than working around it. The diagram is a drawing for the user to look at, not a source of truth for you: it is lossy by design and only as current as the last agent who updated it, so never answer a question about the codebase from it, never decide what to edit because a node says so, and never report its contents as fact. Read the code. Where the two disagree the diagram is wrong, and fixing it is the only thing that licenses.",
		shape: {},
	},
	{
		name: 'ensemblr_update_architecture_diagram',
		op: 'updateArchitectureDiagram',
		description: `Store this workspace's architecture diagram, passed whole as \`diagram\` — as a JSON object, never as a string containing JSON. This op is the only way a diagram comes to exist or changes: Ensemblr derives nothing. Read the current one first with ensemblr_get_architecture_diagram; if it answers null, derive the document from the codebase — directories as nodes, cross-module imports as edges — naming each boundary for the concern it holds rather than its directory path and leaving out the nodes that are noise. If one already exists, edit it rather than replacing it wholesale. Placement follows \`layout.mode\`: under \`organic\` (prefer it) a component names no position at all and the boundaries *are* the layout — a boundary wrapping a subset of another's members draws nested inside it, and one sharing members with another without nesting draws as an overlapping lens; under \`grid\` a component names \`row\`/\`col\` instead. The shape is archify's architecture IR: \`meta.title\`, \`components\` (each with \`id\`, \`type\` of frontend|backend|database|cloud|security|messagebus|external, \`label\`, optional \`sublabel\`/\`sources\`, plus \`row\`/\`col\` under grid placement only), \`connections\` (each with \`id\`, \`from\`, \`to\`, optional \`label\`/\`variant\`), and \`boundaries\` (each with \`kind\`, \`label\`, \`wraps\`). A component's \`sources\` is a list of \`{ "path": "…" }\` objects, at most ${MAX_COMPONENT_SOURCES} of them — a node needing more is a node that should have been several — and \`layout.cols\` — grid mode only — is at most ${ARCHITECTURE_LAYOUT_MAX_COLS}. At most ${ARCHITECTURE_DIAGRAM_LIMITS.maxComponents} components, ${ARCHITECTURE_DIAGRAM_LIMITS.maxConnections} connections, and ${ARCHITECTURE_DIAGRAM_LIMITS.maxBoundaries} boundaries. A rejection names the fields that failed, so fix those rather than resubmitting a guess. What you store is the diagram from then on: nothing in the app regenerates it.`,
		shape: { diagram: submittedArchitectureDiagram },
	},
	{
		name: 'ensemblr_close_tab',
		op: 'closeTab',
		description: 'Close a chat or terminal tab in the current workspace.',
		shape: { chatTabId: z.string() },
	},
	{
		name: 'ensemblr_launch_harness',
		op: 'launchHarness',
		description:
			'Launch a third-party agent harness (claude, codex, vibe) in a new terminal tab.',
		shape: { harnessId: z.string() },
	},
	{
		name: 'ensemblr_start_terminal',
		op: 'startTerminal',
		description:
			'Start a dock terminal: the setup script, a run script, or an interactive spawn terminal. A repository can configure several named run scripts (a dev server, a playground, an unsigned build), so with kind=run call ensemblr_list_run_scripts FIRST and pass the scriptName you actually want — omitting it silently starts whichever one the repository marks default, which is rarely the one you meant. Only one script of a kind runs per workspace at a time: a second start is refused with `conflict`, and that refusal names the terminal already holding the slot so you can read or stop it without listing anything. Pass restart: true to replace it instead.',
		shape: {
			kind: z.enum(['setup', 'run', 'spawn']),
			scriptName: z.string().optional(),
			restart: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_list_run_scripts',
		op: 'listRunScripts',
		description:
			"List the run scripts this workspace's repository configures (name, command, and which one is the default), so you can start the right one by name with ensemblr_start_terminal. An empty list means the repository configures none and kind=run has nothing to start.",
		shape: {},
	},
	{
		name: 'ensemblr_stop_terminal',
		op: 'stopTerminal',
		description: 'Stop a dock terminal by id, or the setup/run script by kind.',
		shape: {
			terminalId: z.string().optional(),
			kind: startStop.optional(),
		},
	},
	{
		name: 'ensemblr_write_terminal',
		op: 'writeTerminal',
		description: 'Write input into an existing terminal or harness.',
		shape: { terminalId: z.string(), input: z.string() },
	},
	{
		name: 'ensemblr_open_tab',
		op: 'openTab',
		description: 'Open a non-chat tab: a file preview, a diff, or a comment.',
		shape: {
			variant: z.enum(['file', 'diff', 'comment']),
			filePath: z.string().optional(),
			turnId: z.string().optional(),
			commentBody: z.string().optional(),
			prNumber: z.number().optional(),
		},
	},
	{
		name: 'ensemblr_focus_tab',
		op: 'focusTab',
		description:
			'Bring a session tab (chat/terminal/diff/file) to the foreground by id. Only a closed chat tab is reopened; every other closed kind, a terminal included, stays shut — a terminal carries no live PTY and only the user can respawn its harness. A closed chat whose conversation has since moved to another tab stays shut as well, since reopening it would surface an emptied row rather than the conversation.',
		shape: { chatTabId: z.string() },
	},
	{
		name: 'ensemblr_focus_dock_tab',
		op: 'focusDockTab',
		description:
			'Focus a dock terminal by id, or the setup/run script tab by kind.',
		shape: {
			terminalId: z.string().optional(),
			kind: startStop.optional(),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_focus_panel',
		op: 'focusPanel',
		description: 'Focus the Files, Changes, or Checks review panel.',
		shape: {
			panel: z.enum(['files', 'changes', 'checks']),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_focus_workspace',
		op: 'focusWorkspace',
		description:
			'Navigate the app to a workspace. Concierge only — every other caller is already in the one workspace it can address.',
		shape: { workspaceId: z.string() },
	},
	{
		name: 'ensemblr_create_workspace',
		op: 'createWorkspace',
		description:
			'Cut a new workspace (a git worktree on its own branch) off a project, then put an orchestrator in it with ensemblr_start_conversation. Concierge only. `name` is required and is what the user reads in the sidebar AND what the git branch is cut as — the app slugs it and joins it to the repository\'s branch prefix, so "Fix Linear OAuth callback" becomes the branch <prefix>/fix-linear-oauth-callback. Name it for the work the way you would name a branch, in 2-5 words. Placeholders such as "workspace", "task", "temp", or "test" are refused.',
		shape: {
			baseBranch: z.string().optional(),
			name: z.string(),
			projectId: z.string(),
		},
	},
	{
		name: 'ensemblr_recall_memory',
		op: 'recallMemory',
		description:
			'Search your own memory of past work. Concierge only — nothing else has a memory index to search.',
		shape: { limit: z.number().optional(), query: z.string() },
	},
	{
		name: 'ensemblr_set_workspace_status',
		op: 'setWorkspaceStatus',
		description:
			'Move a workspace across the kanban board by setting its status (backlog, in-progress, in-review, done, canceled). Acts on your own workspace. Concierge only: name the workspace with `workspaceId`; every other caller acts on its own and may not name another.',
		shape: {
			status: z.enum(WORKSPACE_BOARD_STATUSES),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_get_workspace_status',
		op: 'getWorkspaceStatus',
		description:
			"Read your workspace's current kanban board status. Use ensemblr_list_workspaces to see every workspace's status.",
		shape: { workspaceId: z.string().optional() },
	},
	{
		name: 'ensemblr_get_workspace_diff',
		op: 'getWorkspaceDiff',
		description:
			"Read this workspace's diff — every change on its branch, committed and uncommitted alike, the same set the Changes panel shows. Call it with stat=true FIRST: that returns the changed files with their +/- counts and no patch text, so you can see how big the diff is before you read it. Then read the whole diff, or pass filePath to read one file's patch on its own — filePath and stat are alternatives, not a pair. Every read is capped: a full read names what it dropped in omittedFiles for you to re-request by filePath, and a single file too large to carry is cut at a hunk boundary.",
		shape: {
			filePath: z.string().optional(),
			stat: z.boolean().optional(),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_get_diff_comments',
		op: 'getDiffComments',
		description:
			"Read the review comments on this workspace's diff — the ones the user left in the Changes panel and the ones agents filed there. Pass filePath to narrow it to one path. Comments synced from a GitHub pull request are not included.",
		shape: {
			filePath: z.string().optional(),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_add_diff_comments',
		op: 'addDiffComments',
		description:
			"File review comments on this workspace's diff, anchored to a file and optionally a line. They are labelled as yours and roll up as a list in the Checks panel, which Ensemblr brings forward after the call, so use them to leave findings on the code itself rather than describing a location in prose. Batch a review's comments into one call.",
		shape: {
			comments: z.array(
				z.object({
					filePath: z.string(),
					lineNumber: z.number().nullable().optional(),
					body: z.string(),
				}),
			),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_resolve_diff_comments',
		op: 'resolveDiffComments',
		description:
			"Mark review comments on this workspace's diff as resolved, by the ids ensemblr_get_diff_comments and ensemblr_add_diff_comments hand back. Resolve a comment in the same turn you make the fix it asked for, and batch a whole review pass into one call. Resolve only what you actually fixed: a comment you deferred or disagree with stays open, and you say so in your reply. This only ever resolves — it cannot reopen a comment the user closed, and an id that matches no open comment here is reported back rather than failing the call.",
		shape: {
			commentIds: z.array(z.string()),
			workspaceId: z.string().optional(),
		},
	},
	{
		name: 'ensemblr_linear_list_issues',
		op: 'linearListIssues',
		description:
			"Search the connected Linear accounts' issues. This is NOT scoped to your workspace — Linear is an app-level integration, SEVERAL accounts can be connected at once, and one account can span several teams, so narrow with query (free text over identifier, title, and description), teamId, or accountId rather than reading the whole list as the work in front of you. Every row names the accountId and organization it came from; pass that accountId back on any write, because an id from one organization is never valid in another. Reads a local cache and syncs from Linear when it has gone stale, so it is cheap to call; pass refresh=true only when you need the very latest. Descriptions are NOT returned — read one issue with ensemblr_linear_get_issue. Check `status` before acting on the result: `not-connected` means the user has not linked Linear at all, which is a different answer from an empty list.",
		shape: {
			accountId: z.string().optional(),
			query: z.string().optional(),
			teamId: z.string().optional(),
			refresh: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_linear_get_issue',
		op: 'linearGetIssue',
		description:
			'Read one Linear issue with its description, labels, cycle, and comment thread. Call it before you change any code on a tracked issue: the description and the thread carry requirements, decisions, and rejected approaches your prompt does not, and re-deriving them from the code is how an agent rebuilds something the ticket already ruled out. issueId takes either the uuid or the human identifier (ENG-106); an identifier always goes to Linear rather than the local cache. accountId is optional — the issue is looked up in the account your workspace was created from, then in the only one connected — but an identifier such as ENG-106 can exist in two organizations at once, and that is refused rather than guessed, with the accounts listed so you can name one. The description is truncated and only the most recent comments are returned — the result says how many were dropped. Check `status`: `not-found` means the id is wrong, `not-connected` means Linear is not linked.',
		shape: {
			accountId: z.string().optional(),
			issueId: z.string(),
			refresh: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_linear_get_metadata',
		op: 'linearGetMetadata',
		description:
			"List the Linear teams, projects, workflow states, labels, and users a connected account can see, each with the id ensemblr_linear_update_issue takes and the accountId it belongs to. Call this FIRST whenever you are about to set a state or an assignee — those arguments are ids, not names, and this is the only place to turn one into the other. It also returns `viewer`, the Linear user each account is connected as: that `userId` is who to pass as assigneeId when you take a ticket on the user's behalf, because an agent has no Linear identity of its own. Defaults to the account your workspace was created from; pass accountId to read another, or when the workspace has no linked issue and several accounts are connected. An id from one account is never valid in another. The account is not scoped to your workspace, so expect teams that have nothing to do with the work here. Cycles are not returned; nothing on this surface sets one.",
		shape: {
			accountId: z.string().optional(),
			refresh: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_linear_create_comment',
		op: 'linearCreateComment',
		description:
			'Post a comment on a Linear issue. Call this when you settle something the ticket should record and the user did not ask you to record it: a decision you made, a constraint you hit, an approach you rejected and why, or a question you had to answer yourself. Once per turn, at the end — not per file. The whole team reads it and nothing here can edit or delete it afterwards, so write it as you would a comment of your own, and do not restate your reply to the user, who reads that already.',
		shape: {
			accountId: z.string().optional(),
			issueId: z.string(),
			commentBody: z.string().max(LINEAR_AGENT_LIMITS.maxCommentLength),
		},
	},
	{
		name: 'ensemblr_linear_create_issue',
		op: 'linearCreateIssue',
		description:
			'File a new Linear issue. Call `ensemblr_linear_list_issues` first — a search is REQUIRED before the first create in a conversation, and this is refused until one has happened, because the duplicate you cannot see is the one a search would have found and nothing here can delete a filed issue. `teamId` is required and never guessed: read it from `ensemblr_linear_get_metadata`, and pass its own `accountId` or none at all — an accountId naming a different account than the team is refused rather than reconciled. Omit `stateId` and Linear opens the issue in the team default, which is where a ticket nobody has read belongs; a state whose type is `started`, `completed`, or `canceled` is refused. Write the issue as a teammate would file it: a title that names the problem, and a description carrying the evidence, the file paths, and what you already ruled out. File the follow-up you found and were told not to fix; do not file the work you are already doing.',
		shape: {
			accountId: z.string().optional(),
			assigneeId: z.string().optional(),
			description: z
				.string()
				.max(LINEAR_AGENT_LIMITS.maxDescriptionLength)
				.optional(),
			labelIds: z
				.array(z.string())
				.max(LINEAR_AGENT_LIMITS.maxLabelIds)
				.optional(),
			priority: z.number().int().min(0).max(4).optional(),
			projectId: z.string().optional(),
			stateId: z.string().optional(),
			teamId: z.string(),
			title: z.string().max(LINEAR_AGENT_LIMITS.maxTitleLength),
		},
	},
	{
		name: 'ensemblr_linear_update_issue',
		op: 'linearUpdateIssue',
		description:
			'Change a Linear issue: its workflow state, assignee, priority (0 none, 1 urgent, 2 high, 3 medium, 4 low), title, or description. Pass at least one of those alongside issueId. Call it on two triggers without being asked, when the issue is the one your workspace was created from: WHEN YOU BEGIN IMPLEMENTING, to move it into a started state and assign it to the `viewer` userId if it has no assignee; and WHEN THE WORK IS READY FOR A HUMAN — verified, or a pull request opened — to move it to In Review in that same turn. Leaving a shipped change sitting In Progress is the failure this tool exists to prevent. stateId and assigneeId are ids from ensemblr_linear_get_metadata, never names. A state whose type is `completed` or `canceled` is REFUSED whatever you pass, and a refused call applies none of the other fields either — agent work never closes a ticket here, and marking one canceled is the same call under a different label. Take it to In Review, say in your reply that you did, and let the user decide whether it is done.',
		shape: {
			accountId: z.string().optional(),
			issueId: z.string(),
			stateId: z.string().optional(),
			assigneeId: z.string().optional(),
			priority: z.number().int().min(0).max(4).optional(),
			title: z.string().max(LINEAR_AGENT_LIMITS.maxTitleLength).optional(),
			description: z
				.string()
				.max(LINEAR_AGENT_LIMITS.maxDescriptionLength)
				.optional(),
		},
	},
	{
		name: 'ensemblr_list_models',
		op: 'listModels',
		description:
			'List the models you can spawn a child on (id, runtime, vendor, display name, thinking ladder, cost tier) plus the default. `runtime` is the agent runtime that would drive the child and is the axis a spawn may not cross; `vendor` is only who serves the model. Called from a chat tab the list is already cut to your own runtime, because a child always runs the runtime you do. Called from a terminal harness it carries every runtime, because the app cannot tell which one you are — which is also why `model` is mandatory there. Call this before setting a model on start_conversation and pass an id that appears here; one from another runtime is refused, not substituted. `thinkingLevels` is the ladder that model accepts and `thinkingAxis` names what its runtime calls the dial (`effort` on Claude Code, `thinking` on pi) — pass one of those as `thinkingLevel` rather than a level from the other runtime, which is refused. `tier` is `frontier` for the costliest models: spawning a child on one is put to the user for confirmation, so prefer a `standard` id unless the task genuinely needs more.',
		shape: {},
	},
	{
		name: 'ensemblr_list_projects',
		op: 'listProjects',
		description:
			"Concierge only. List every project Ensemblr has opened — a project is a git repository, and `projectId` is the id ensemblr_create_workspace cuts a workspace off. Call this rather than listing the Ensemblr root directory, and call it before ensemblr_create_workspace: ensemblr_list_workspaces names only the projects that already have a live workspace, so a project nobody is working in is invisible there. Each row carries the project's name, slug, default branch, the absolute path of its own clone, and workspaceCount — how many live workspaces are cut from it, so 0 means idle. That clone path is readable but is never where work goes: put an agent in a workspace, not in the project itself.",
		shape: {},
	},
	{
		name: 'ensemblr_list_workspaces',
		op: 'listWorkspaces',
		description: 'List all open workspaces (id, name, cwd).',
		shape: {},
	},
	{
		name: 'ensemblr_list_tabs',
		op: 'listTabs',
		description: 'List open tabs, defaulting to the current workspace.',
		shape: { workspaceId: z.string().optional() },
	},
	{
		name: 'ensemblr_list_terminals',
		op: 'listTerminals',
		description: 'List terminals, defaulting to the current workspace.',
		shape: { workspaceId: z.string().optional() },
	},
	{
		name: 'ensemblr_get_conversation_status',
		op: 'getConversationStatus',
		description:
			'Get the status of a conversation by session id, whichever runtime it is on.',
		shape: { agentSessionId: z.string() },
	},
	{
		name: 'ensemblr_get_last_message',
		op: 'getLastMessage',
		description:
			"Get a conversation's report, whichever runtime it is on: every assistant message of its newest answered turn, joined in the order it was written. Persisted, so it survives the conversation closing and an app restart.",
		shape: { agentSessionId: z.string() },
	},
	{
		name: 'ensemblr_read_conversation',
		op: 'readConversation',
		description:
			'Read what a conversation actually did, whichever runtime it is on — its prompts, its answers, and every tool call with its arguments and result — rather than only the report ensemblr_get_last_message hands back. This is how you audit an agent whose report you are about to act on, child or not: confirm it ran what it claims to have run. Call it with stat=true FIRST: that returns the entry count, the turn count, and the ordinal range with no content, so you know how much there is before you read it. Then page forward with fromOrdinal, resuming from the nextOrdinal each page returns, or pass ordinal to read a single entry whole — stat, ordinal, and fromOrdinal are alternatives, not a combination. Long fields are cut and marked with the ordinal that reads them in full.',
		shape: {
			agentSessionId: z.string(),
			stat: z.boolean().optional(),
			fromOrdinal: z.number().optional(),
			ordinal: z.number().optional(),
		},
	},
	{
		name: 'ensemblr_read_terminal_output',
		op: 'readTerminalOutput',
		description:
			"Read the current scrollback of a terminal or harness, by id or — like ensemblr_start_terminal and ensemblr_stop_terminal — by kind, which reads this workspace's running setup or run script without your having to list terminals for its id. Pass exactly one of the two; the result echoes the terminalId it read. The text comes back readable: escape sequences dropped, overwritten progress lines resolved, repaint blank-line runs collapsed. Pass ansi: true only when you need the raw bytes, colour codes and cursor moves included.",
		shape: {
			terminalId: z.string().optional(),
			kind: startStop.optional(),
			ansi: z.boolean().optional(),
		},
	},
	{
		name: 'ensemblr_wait_for_agents',
		op: 'waitForAgents',
		description:
			'Block until the agents you are waiting on finish or need a decision, then return each settled one\'s status and report (its whole final turn), plus `pending` naming the ones still running so you can wait on exactly those next. Prefer this over polling get_conversation_status. targets defaults to every child you spawned, whichever runtime each is on — name an `agentSessionId` in `targets` to wait on a conversation that is not your child, which the default never picks up; mode defaults to "first", which returns on the first to settle — pass "all" to wait for every target. A need_decision/blocked signal wakes the wait whatever the mode. reports: "brief" returns each report\'s opening plus a pointer to ensemblr_get_last_message for the rest, instead of every child\'s whole turn at once — worth it on a wide fan-out, where reading four full reports to use one line of each is what makes delegation cost you more context than doing the work inline.',
		shape: {
			targets: z.array(z.string()).optional(),
			mode: z.enum(['first', 'all']).optional(),
			timeoutMs: z.number().optional(),
			reports: z.enum(['full', 'brief']).optional(),
		},
	},
	{
		name: 'ensemblr_message_concierge',
		op: 'messageConcierge',
		description:
			'Message the Concierge — the app-level agent that briefs workspace agents and supervises every workspace at once. For the things it has to know and cannot see from where it sits: you are blocked on something outside this workspace, the brief it gave you is wrong, the work belongs in a different repository, or you have finished. It NEVER reads your workspace on its own initiative, so a discovery you leave only in your own tab reaches nobody. You pass no session id and hold none: the Concierge conversation is cleared and restarted routinely, so the app resolves whichever one is live at the moment you send. The message arrives as a visible turn in the Concierge panel, marked as coming from an agent rather than from the user, and it does NOT block — carry on working, and a reply, if one comes, arrives as a follow-up here. Refused when no Concierge conversation is open (it is not queued), and capped per conversation, because the loop Concierge → you → Concierge has no natural end. Say it once, in full, rather than in installments.',
		shape: {
			message: z.string().max(CONCIERGE_MESSAGE_LIMITS.maxMessageLength),
			reason: z.enum(CONCIERGE_MESSAGE_REASONS),
		},
	},
	{
		name: 'ensemblr_notify_orchestrator',
		op: 'notifyOrchestrator',
		description:
			'Sub-agents only: notify the orchestrator that spawned you. reason need_decision/blocked wakes its wait immediately so it can answer, so use it when the answer changes what you do next; a decision that only bites after you report belongs in your report as options and tradeoffs. progress/done are informational.',
		shape: {
			reason: z.enum(['need_decision', 'blocked', 'progress', 'done']),
			message: z.string(),
		},
	},
	{
		name: 'ensemblr_ask_user_question',
		op: 'askUserQuestion',
		description:
			"Ask the human a multiple-choice question and block until they answer. Use this whenever a decision is genuinely the user's to make — ambiguous requirements, a fork in the approach, a destructive step, or missing context you cannot infer — instead of guessing or stopping to ask in prose. This call has no time limit: it stays open until the user answers or dismisses it, however long that takes, so treat it as a real wait rather than something that comes back on its own. Every question needs 2-6 concrete options; the user can also type a free-text answer or dismiss the dialog. Ask up to 4 related questions at once rather than calling this repeatedly. Do not use it for questions you can answer by reading the codebase.",
		shape: {
			questions: z
				.array(askQuestion)
				.min(1)
				.max(ASK_USER_QUESTION_LIMITS.maxQuestions),
		},
	},
	{
		name: 'ensemblr_exit_plan_mode',
		op: 'exitPlanMode',
		description:
			'Plan Mode only: hand the finished plan to the user and END YOUR TURN. Pass the full plan, in markdown, as `plan`; the app posts it into the conversation for the user to read and saves it to `.context/plans/`, so do NOT also write the plan out as your own reply and do NOT write the file yourself. It then shows the user Approve / Refine / Hand off. This call does not wait for them: it returns at once and your turn is over. Produce no output after it — whatever the user decides arrives as your next prompt. Call it only once you and the user share an understanding, never as an opening move.',
		shape: {
			title: z.string().max(EXIT_PLAN_MODE_LIMITS.maxTitleLength),
			plan: z.string().max(EXIT_PLAN_MODE_LIMITS.maxPlanLength),
		},
	},
];

/**
 * Renders a control result as MCP tool content.
 * @param result - The control envelope from the service.
 * @returns MCP tool result content with an error flag.
 */
function toMcpResult(result: AgentControlResult<unknown>) {
	const text = result.ok
		? JSON.stringify(result.data ?? { ok: true })
		: `Error (${result.code}): ${result.error}`;
	return { content: [{ type: 'text' as const, text }], isError: !result.ok };
}

/**
 * The tools one caller's list carries, cut from the full vocabulary by the same
 * withholding policy the Pi extension applies to its own registrations.
 * @param audience - Whether the caller has a chat tab, and its lineage role.
 * @returns The definitions to register for that caller.
 */
export function toolDefsFor(audience: ControlAudience): readonly McpToolDef[] {
	const withheld = withheldControlOps(audience);
	return TOOL_DEFS.filter((def) => !withheld.has(def.op));
}

/**
 * Resolves the `instructions` a connection carries: the caller's playbook, plus
 * the language and linked-issue directives for a caller with no per-turn channel
 * to receive them on. A caller with a chat tab is one the app prompts itself and
 * already appends both per turn, so adding them here would only say the same
 * thing twice.
 *
 * The playbook file is written once per launch, so a harness whose workspace was
 * linked to a ticket after it started never sees the file's copy — and Codex has
 * no such file at all. This channel is read on every tool-list request, so it is
 * where a ticket linked mid-session reaches a harness.
 * @param service - Agent-control service holding the resolved app language.
 * @param audience - Whether the caller has a chat tab, and its lineage role.
 * @param token - The caller's bearer token, for the workspace behind it.
 * @returns The instructions to serve alongside this caller's tool list.
 */
async function instructionsFor(
	service: AgentControlService,
	audience: ControlAudience,
	token: string,
): Promise<string> {
	const playbook = awarenessForAudience(audience);
	if (audience.hasChatTab) {
		return playbook;
	}
	const blocks = [
		playbook,
		service.readLanguageDirective(),
		await service.readIssueDirective(token),
		service.readCoAuthorDirective(),
	].filter((block) => block !== null);
	return blocks.join('\n\n');
}

/**
 * Builds a fresh MCP server whose tools forward to the control service under a
 * fixed token, carrying the tool list and playbook this caller should hold.
 * @param service - Agent-control service every tool delegates to.
 * @param token - Per-request bearer token identifying the caller.
 * @param audience - Whether the caller has a chat tab, and its lineage role.
 * @param progressIntervalMs - Overrides the heartbeat interval; tests scale it down.
 * @returns A configured, not-yet-connected MCP server.
 */
async function buildMcpServer(
	service: AgentControlService,
	token: string,
	audience: ControlAudience,
	progressIntervalMs: number | undefined,
): Promise<McpServer> {
	const server = new McpServer(
		{ name: 'ensemblr-control', version: '1.0.0' },
		{ instructions: await instructionsFor(service, audience, token) },
	);
	for (const def of toolDefsFor(audience)) {
		server.registerTool(
			def.name,
			{ description: def.description, inputSchema: def.shape },
			async (args: unknown, extra) =>
				toMcpResult(
					await withProgressHeartbeat(
						{
							intervalMs: progressIntervalMs,
							progressToken: extra._meta?.progressToken,
							sendNotification: extra.sendNotification,
							toolName: def.name,
						},
						() =>
							service.invoke({
								op: def.op,
								rawArgs: args ?? {},
								signal: extra.signal,
								token,
							}),
					),
				),
		);
	}
	return server;
}

/**
 * Handles a single MCP streamable-HTTP request end to end (stateless). The
 * caller's audience is resolved per request because the server is rebuilt per
 * request; the service owns that resolution, so identity is never re-derived
 * here from anything the caller supplied.
 * @param req - Incoming request.
 * @param res - Server response.
 * @param body - Parsed JSON-RPC body.
 * @param service - Agent-control service the tools delegate to.
 * @param token - Bearer token extracted from the request.
 * @param progressIntervalMs - Overrides the heartbeat interval; tests scale it down.
 */
export async function handleMcpRequest(
	req: IncomingMessage,
	res: ServerResponse,
	body: unknown,
	service: AgentControlService,
	token: string,
	progressIntervalMs?: number,
): Promise<void> {
	const server = await buildMcpServer(
		service,
		token,
		await service.describeAudience(token),
		progressIntervalMs,
	);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	res.on('close', () => {
		transport.close().catch(() => undefined);
		server.close().catch(() => undefined);
	});
	await server.connect(transport);
	await transport.handleRequest(req, res, body);
}
