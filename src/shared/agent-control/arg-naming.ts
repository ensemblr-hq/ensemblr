/**
 * The naming system behind every agent-facing argument key on the control
 * surface. Three sites describe the same ops — the Pi extension's TypeBox
 * schemas, the MCP endpoint's `TOOL_DEFS`, and the authoritative Zod schemas in
 * `schemas.ts` — so a concept spelled two ways reaches a model as two words for
 * one thing, and it guesses. This module is the single place that says which
 * word carries which concept, plus the near-misses the boundary forgives rather
 * than spending a turn to reject.
 *
 * Scope is the agent-facing surface only. The main-process ports behind it keep
 * their own vocabulary, and the service maps between the two at dispatch.
 */
import type { AgentControlOp } from './contracts.ts';

/**
 * Every argument key an op may take, and the concept it carries. An op needing a
 * concept already listed reuses its key instead of coining a synonym; one
 * needing a genuinely new concept adds a row here first. A conformance test
 * holds every schema against this table, so a second spelling of an existing
 * concept cannot reach a model.
 */
export const CANONICAL_ARG_KEYS = {
	accountId:
		'Identifier of one connected tracker account. Several can be connected at once, and an id from one is never valid in another.',
	agentSessionId: 'Identifier of an agent conversation.',
	ansi: 'Return raw terminal bytes with their escape sequences, not readable text.',
	assigneeId: 'Identifier of the person an issue is assigned to.',
	chatTabId: 'Identifier of a chat tab in the workspace.',
	command: 'Shell command a guarded tool call is about to run.',
	commentBody: 'Markdown body of a comment an op writes or opens a tab on.',
	commentIds: 'Ids of review comments an op acts on.',
	comments: 'Batch of review comments to file against the diff.',
	description: 'Markdown body of a tracker issue.',
	filePath:
		'Workspace-relative path of a file, e.g. src/main/main.ts. Never `file` or `path`.',
	fromOrdinal: 'Inclusive lower bound when paging a transcript.',
	harnessId: 'Identifier of a third-party agent harness.',
	input: 'Raw text written into a terminal, keystrokes included.',
	issueId: 'Identifier of a tracker issue, or its human key such as ENG-106.',
	kind: 'Which of a fixed set of variants an op acts on.',
	limit: 'Upper bound on how many results a listing returns.',
	message: 'Prose addressed to a human or to the orchestrator.',
	mode: 'How an op behaves across several targets.',
	model: 'Identifier of the agent model a conversation runs on.',
	baseBranch: 'Branch a new workspace measures its diff against.',
	name: 'Identity of a durable, addressable thing — the workspace and its git branch, a run script. Never the label of a tab or an artifact; that is `title`.',
	ordinal: 'Position of a single transcript entry.',
	panel: 'Which review panel to bring forward.',
	path: 'Filesystem path a guarded tool call is about to write.',
	plan: 'Markdown plan handed to the user.',
	prNumber: 'Number of the pull request a tab is opened on.',
	priority: "Urgency rank of a tracker issue, on the tracker's own scale.",
	projectId: 'Identifier of a tracked git repository.',
	prompt: 'Text submitted to a conversation as a turn.',
	query: 'Free-text search narrowing a listing.',
	questions: 'Batch of multiple-choice questions put to the user.',
	reason: 'Why a signal was raised.',
	refresh: 'Re-read from the remote source instead of serving the cache.',
	reports: 'How much of each child report to return.',
	restart: 'Replace whatever is already running instead of being refused.',
	scriptName: 'Name of a run script the repository configures.',
	stat: 'Return counts and totals only, with no body text.',
	stateId: 'Identifier of the workflow state a tracker issue sits in.',
	status: 'Kanban board status of a workspace.',
	summary: 'Markdown record of what a session covered.',
	targets: 'Conversations an op acts on.',
	teamId: 'Identifier of a tracker team.',
	terminalId: 'Identifier of a dock terminal or harness.',
	thinkingLevel: 'Reasoning budget a conversation runs at.',
	timeoutMs: 'Upper bound on a blocking call, in milliseconds.',
	title:
		'Human-readable label of a UI surface or an artifact — a chat tab, a plan, a summary, a tracker issue. Never `name`.',
	tool: 'Name of the built-in tool a guarded call is about to use.',
	turnId: 'Identifier of the conversation turn a tab is opened on.',
	userRequested:
		'Whether the user asked for this action in so many words, lifting a gate that otherwise only opens once.',
	variant: 'Which kind of non-chat tab to open.',
	wait: 'Block until the conversation being addressed goes idle.',
	workspaceId: 'Identifier of an open workspace.',
} as const satisfies Record<string, string>;

/** An argument key the control surface recognises. */
type CanonicalArgKey = keyof typeof CANONICAL_ARG_KEYS;

/**
 * Argument keys the boundary rewrites to their canonical name before an op's
 * schema runs, keyed by op. Every entry is a spelling the tool's own name
 * invites — `ensemblr_set_name` invites `name`, `ensemblr_set_branch_name`
 * invites `slug` — and rejecting one costs a round trip to teach what the
 * description already said. Rewriting is silent for that reason: the canonical
 * key travels to the model in the tool schema, not in an error.
 */
export const AGENT_CONTROL_ARG_ALIASES = {
	exitPlanMode: { name: 'title' },
	getDiffComments: { file: 'filePath', path: 'filePath' },
	getWorkspaceDiff: { file: 'filePath', path: 'filePath' },
	linearCreateComment: {
		body: 'commentBody',
		id: 'issueId',
		identifier: 'issueId',
	},
	linearGetIssue: { id: 'issueId', identifier: 'issueId' },
	linearListIssues: { search: 'query' },
	linearUpdateIssue: { id: 'issueId', identifier: 'issueId' },
	openTab: { file: 'filePath', path: 'filePath' },
	setBranchName: { branchName: 'name', slug: 'name' },
	setName: { name: 'title' },
	setSummary: { name: 'title' },
	spawnChatTab: { name: 'title' },
	startConversation: { name: 'title' },
} as const satisfies Partial<
	Record<AgentControlOp, Readonly<Record<string, CanonicalArgKey>>>
>;

/**
 * Whether a value is an argument object whose keys the boundary can rewrite.
 * @param value - Untrusted payload from the agent.
 * @returns True when the value is a plain object.
 */
const isArgObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Rewrites an op's known near-miss argument keys to their canonical names,
 * leaving every other key untouched. A canonical key the agent already sent wins
 * over an alias sent beside it, so a call carrying both spellings resolves to
 * the one the schema documents rather than to whichever key came last.
 * @param op - Operation the arguments belong to.
 * @param rawArgs - Untrusted argument object from the agent.
 * @returns A new argument object with aliases resolved, or the input unchanged when there is nothing to rewrite.
 */
export function canonicalizeArgs(
	op: AgentControlOp,
	rawArgs: unknown,
): unknown {
	const aliases: Readonly<Record<string, string>> | undefined =
		AGENT_CONTROL_ARG_ALIASES[op as keyof typeof AGENT_CONTROL_ARG_ALIASES];
	if (!aliases || !isArgObject(rawArgs)) {
		return rawArgs;
	}
	const canonical: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rawArgs)) {
		const canonicalKey = aliases[key];
		if (canonicalKey && canonicalKey in rawArgs) {
			continue;
		}
		canonical[canonicalKey ?? key] = value;
	}
	return canonical;
}
