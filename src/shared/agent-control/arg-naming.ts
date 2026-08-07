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
	agentSessionId: 'Identifier of an agent conversation.',
	chatTabId: 'Identifier of a chat tab in the workspace.',
	command: 'Shell command a guarded tool call is about to run.',
	commentBody: 'Markdown body of the comment a tab is opened on.',
	comments: 'Batch of review comments to file against the diff.',
	filePath:
		'Workspace-relative path of a file, e.g. src/main/main.ts. Never `file` or `path`.',
	fromOrdinal: 'Inclusive lower bound when paging a transcript.',
	harnessId: 'Identifier of a third-party agent harness.',
	input: 'Raw text written into a terminal, keystrokes included.',
	kind: 'Which of a fixed set of variants an op acts on.',
	message: 'Prose addressed to a human or to the orchestrator.',
	mode: 'How an op behaves across several targets.',
	model: 'Identifier of the agent model a conversation runs on.',
	name: 'Identity of a durable, addressable thing — the workspace and its git branch, a run script. Never the label of a tab or an artifact; that is `title`.',
	ordinal: 'Position of a single transcript entry.',
	panel: 'Which review panel to bring forward.',
	plan: 'Markdown plan handed to the user.',
	prNumber: 'Number of the pull request a tab is opened on.',
	prompt: 'Text submitted to a conversation as a turn.',
	questions: 'Batch of multiple-choice questions put to the user.',
	reason: 'Why a signal was raised.',
	reports: 'How much of each child report to return.',
	scriptName: 'Name of a run script the repository configures.',
	stat: 'Return counts and totals only, with no body text.',
	status: 'Kanban board status of a workspace.',
	summary: 'Markdown record of what a session covered.',
	targets: 'Conversations an op acts on.',
	terminalId: 'Identifier of a dock terminal or harness.',
	thinkingLevel: 'Reasoning budget a conversation runs at.',
	timeoutMs: 'Upper bound on a blocking call, in milliseconds.',
	title:
		'Human-readable label of a UI surface or an artifact — a chat tab, a plan, a summary. Never `name`.',
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
	return Object.fromEntries(
		Object.entries(rawArgs)
			.filter(([key]) => !aliases[key] || !(aliases[key] in rawArgs))
			.map(([key, value]) => [aliases[key] ?? key, value]),
	);
}
