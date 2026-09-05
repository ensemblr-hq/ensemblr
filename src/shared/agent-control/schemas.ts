/**
 * Zod validators for agent-control operation arguments. Agents are untrusted
 * input, so every op's args are parsed at the service boundary before anything
 * runs. Each schema is keyed by its {@link AgentControlOp} in {@link AGENT_CONTROL_ARG_SCHEMAS}.
 */
import { z } from 'zod';
import { toSlug } from '../slug.ts';
import { canonicalizeArgs } from './arg-naming.ts';
import {
	CONCIERGE_MESSAGE_LIMITS,
	CONCIERGE_MESSAGE_REASONS,
} from './concierge-message.ts';
import type { AskUserQuestionReply } from './contracts.ts';
import {
	type AgentControlOp,
	ASK_USER_QUESTION_LIMITS,
	ASK_USER_QUESTION_RESERVED_LABELS,
	DIFF_COMMENT_LIMITS,
	EXIT_PLAN_MODE_LIMITS,
	LINEAR_AGENT_LIMITS,
	SET_BRANCH_NAME_LIMITS,
	WORKSPACE_BOARD_STATUSES,
} from './contracts.ts';

const nonEmpty = z.string().trim().min(1);

/**
 * Whether a path stays inside the workspace it is relative to. Hand-rolled
 * rather than delegated to `node:path` because this module is shared with the
 * renderer bundle, and checked here rather than left to the git service so a
 * traversal attempt comes back as `invalid-args` the agent can correct instead
 * of as a git failure. Both separators are rejected: a Windows-style path
 * reaches a POSIX git as one opaque segment, which hides a `..` from the check.
 * @param value - The agent-supplied path.
 * @returns True when the path is relative and never climbs out.
 */
const staysInsideWorkspace = (value: string): boolean => {
	if (value.includes('\0') || value.startsWith('/') || value.startsWith('\\')) {
		return false;
	}
	if (/^[A-Za-z]:[\\/]/.test(value)) {
		return false;
	}
	return !value.split(/[\\/]/).includes('..');
};

const workspaceRelativePath = nonEmpty.refine(staysInsideWorkspace, {
	message: 'File path must be relative to the workspace and stay inside it.',
});

const spawnChatTabSchema = z.strictObject({
	title: nonEmpty.optional(),
});

// The two peer refinements are rejections rather than silent corrections
// because both would otherwise produce something the caller did not ask for: an
// unnamed second orchestrator tab is indistinguishable from the first on the tab
// strip, and a blocking wait on a peer would hold the spawner's turn open for
// work that is deliberately not its own.
const startConversationSchema = z
	.strictObject({
		chatTabId: nonEmpty.optional(),
		peer: z.boolean().optional(),
		prompt: nonEmpty,
		model: nonEmpty.optional(),
		thinkingLevel: nonEmpty.optional(),
		title: nonEmpty.optional(),
		wait: z.boolean().optional(),
		workspaceId: nonEmpty.optional(),
	})
	.refine((args) => !args.peer || Boolean(args.title), {
		message:
			'A peer orchestrator needs a `title`: it shares the tab strip with the conversation that opened it, and two unnamed orchestrator tabs cannot be told apart.',
	})
	.refine((args) => !args.peer || !args.wait, {
		message:
			'A peer is not a child to wait on — it is a root orchestrator with its own turn and its own user. Drop `wait`, and read its tab when it has something to say.',
	});

const setNameSchema = z.strictObject({
	title: nonEmpty,
});

const setBranchNameSchema = z.strictObject({
	name: nonEmpty.max(SET_BRANCH_NAME_LIMITS.maxRawLength),
	userRequested: z.boolean().optional(),
});

// Deliberately uncapped here: SET_SUMMARY_LIMITS is applied by truncation in the
// service, not by rejection at the boundary. A `.max()` on the body would spend a
// multi-kilobyte round trip to say "shorter", and the transport already bounds the
// payload at the control server's body limit.
const setSummarySchema = z.strictObject({
	title: nonEmpty,
	summary: nonEmpty,
});

// The diagram itself is validated by `architectureIrSchema` in the service,
// which strips unknown keys rather than rejecting them. Validating it twice —
// once loosely here and once strictly there — would let the two drift, so this
// boundary only asserts that something was submitted. Deliberately wide enough
// to admit a JSON string as well as an object: the port decodes one rather than
// blaming the model for a bridge's encoding.
const updateArchitectureDiagramSchema = z.strictObject({
	diagram: z.unknown(),
});

const sendFollowUpSchema = z.strictObject({
	agentSessionId: nonEmpty,
	prompt: nonEmpty,
	wait: z.boolean().optional(),
});

const closeTabSchema = z.strictObject({
	chatTabId: nonEmpty,
});

const launchHarnessSchema = z.strictObject({
	harnessId: nonEmpty,
});

const startTerminalSchema = z
	.strictObject({
		kind: z.enum(['setup', 'run', 'spawn']),
		scriptName: nonEmpty.optional(),
		restart: z.boolean().optional(),
	})
	.refine((value) => !value.scriptName || value.kind === 'run', {
		message: 'scriptName applies to kind "run" only.',
	})
	.refine((value) => !value.restart || value.kind !== 'spawn', {
		message:
			'restart applies to the setup and run scripts only; a spawn terminal has nothing to replace.',
	});

const terminalIdOrKindSchema = z
	.strictObject({
		terminalId: nonEmpty.optional(),
		kind: z.enum(['setup', 'run']).optional(),
	})
	.refine((value) => Boolean(value.terminalId) !== Boolean(value.kind), {
		message: 'Provide exactly one of terminalId or kind.',
	});

const stopTerminalSchema = terminalIdOrKindSchema;

const writeTerminalSchema = z.strictObject({
	terminalId: nonEmpty,
	input: z.string().min(1),
});

const openTabSchema = z
	.strictObject({
		variant: z.enum(['file', 'diff', 'comment']),
		filePath: nonEmpty.optional(),
		turnId: nonEmpty.optional(),
		commentBody: nonEmpty.optional(),
		prNumber: z.number().int().positive().optional(),
	})
	.refine(
		(value) =>
			value.variant === 'comment'
				? Boolean(value.commentBody)
				: Boolean(value.filePath),
		{ message: 'file/diff tabs need filePath; comment tabs need commentBody.' },
	);

const listTabsSchema = z.strictObject({
	workspaceId: nonEmpty.optional(),
});

const listTerminalsSchema = z.strictObject({
	workspaceId: nonEmpty.optional(),
});

const conversationRefSchema = z.strictObject({
	agentSessionId: nonEmpty,
});

const readConversationSchema = z.strictObject({
	agentSessionId: nonEmpty,
	stat: z.boolean().optional(),
	fromOrdinal: z.number().int().min(0).optional(),
	ordinal: z.number().int().min(0).optional(),
});

const readTerminalOutputSchema = z
	.strictObject({
		terminalId: nonEmpty.optional(),
		kind: z.enum(['setup', 'run']).optional(),
		ansi: z.boolean().optional(),
	})
	.refine((value) => Boolean(value.terminalId) !== Boolean(value.kind), {
		message: 'Provide exactly one of terminalId or kind.',
	});

const focusTabSchema = z.strictObject({
	chatTabId: nonEmpty,
});

// Not `terminalIdOrKindSchema` itself: `stopTerminal` shares that object and is
// refused to a Concierge outright, so the cross-workspace argument belongs to
// this op alone rather than to both.
const focusDockTabSchema = z
	.strictObject({
		terminalId: nonEmpty.optional(),
		kind: z.enum(['setup', 'run']).optional(),
		workspaceId: nonEmpty.optional(),
	})
	.refine((value) => Boolean(value.terminalId) !== Boolean(value.kind), {
		message: 'Provide exactly one of terminalId or kind.',
	});

const focusPanelSchema = z.strictObject({
	panel: z.enum(['files', 'changes', 'checks']),
	workspaceId: nonEmpty.optional(),
});

const focusWorkspaceSchema = z.strictObject({
	workspaceId: nonEmpty,
});

/**
 * Slugs a new workspace may not be given.
 *
 * `workspace` is the placeholder the create service falls back to when it is
 * handed no name at all, so accepting it produces exactly the row this rule
 * exists to prevent — a worktree called "workspace" on a branch called
 * `<prefix>/workspace`, which says nothing and collides with the next one. The
 * rest are the stand-ins a model reaches for instead of thinking of a name.
 */
const PLACEHOLDER_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
	'agent',
	'new',
	'new-workspace',
	'scratch',
	'task',
	'temp',
	'test',
	'tmp',
	'untitled',
	'work',
	'workspace',
]);

/**
 * Fewest letters and digits a workspace name may reduce to. Two characters
 * cannot describe work, and the name becomes the branch, so the floor is the
 * branch's too.
 */
const MIN_WORKSPACE_NAME_CHARACTERS = 3;

/**
 * Counts the letters and digits a name survives slugging as, which is what the
 * floor is about: the dashes a slug joins words with describe nothing, so `a b`
 * is two characters rather than three.
 * @param value - The raw name the agent sent.
 * @returns How many alphanumerics the slug holds.
 */
function slugCharacterCount(value: string): number {
	return toSlug(value).replaceAll('-', '').length;
}

/**
 * The name a new workspace is cut with, which is also its branch: the create
 * service slugs it and joins it to the repository's branch prefix. Required
 * rather than optional, and held to a real description, because the fallback is
 * silent — an omitted name yields `workspace` and nobody finds out until they
 * look at the sidebar.
 */
const workspaceName = nonEmpty
	.max(SET_BRANCH_NAME_LIMITS.maxRawLength)
	.refine(
		(value) => slugCharacterCount(value) >= MIN_WORKSPACE_NAME_CHARACTERS,
		{
			message:
				'Name the workspace for the work it will hold, as you would name a branch — e.g. "add dark mode" or "fix-linear-oauth-callback". It must contain at least three letters or digits.',
		},
	)
	.refine((value) => !PLACEHOLDER_WORKSPACE_SLUGS.has(toSlug(value)), {
		message:
			'That is a placeholder, not a name. The workspace and its git branch both carry it, so name it for the work — e.g. "add dark mode" or "fix-linear-oauth-callback".',
	});

const createWorkspaceSchema = z.strictObject({
	baseBranch: nonEmpty.optional(),
	name: workspaceName,
	projectId: nonEmpty,
});

const recallMemorySchema = z.strictObject({
	limit: z.number().int().min(1).max(25).optional(),
	query: nonEmpty,
});

const setWorkspaceStatusSchema = z.strictObject({
	status: z.enum(WORKSPACE_BOARD_STATUSES),
	workspaceId: nonEmpty.optional(),
});

const getWorkspaceStatusSchema = z.strictObject({
	workspaceId: nonEmpty.optional(),
});

const getWorkspaceDiffSchema = z
	.strictObject({
		filePath: workspaceRelativePath.optional(),
		stat: z.boolean().optional(),
		workspaceId: nonEmpty.optional(),
	})
	// Reading one file already knows which file it wants, so a stat alongside it
	// is a contradiction rather than a refinement. Rejecting says which of the two
	// the caller is going to get; silent precedence leaves it guessing.
	.refine((args) => !(args.filePath && args.stat), {
		message:
			'Pass either filePath or stat, not both: a single file has no stat.',
	});

const getDiffCommentsSchema = z.strictObject({
	filePath: workspaceRelativePath.optional(),
	workspaceId: nonEmpty.optional(),
});

const addDiffCommentsSchema = z.strictObject({
	workspaceId: nonEmpty.optional(),
	comments: z
		.array(
			z.strictObject({
				filePath: workspaceRelativePath,
				lineNumber: z.number().int().positive().nullable().optional(),
				body: nonEmpty.max(DIFF_COMMENT_LIMITS.maxBodyLength),
			}),
		)
		.min(1)
		.max(DIFF_COMMENT_LIMITS.maxComments),
});

// Strict with no `status` key on purpose: this op only ever resolves, and a
// caller reaching for `status` is asking for a reopen the tool deliberately
// does not offer. Rejecting says so in one round trip.
const resolveDiffCommentsSchema = z.strictObject({
	commentIds: z.array(nonEmpty).min(1).max(DIFF_COMMENT_LIMITS.maxComments),
	workspaceId: nonEmpty.optional(),
});

// Several Linear accounts can be connected at once. `accountId` stays optional
// on every op because the port resolves it — from the entity named, from the
// calling workspace's linked issue, or from the only account there is — and
// refuses with the account list rather than guessing when it cannot.
const linearListIssuesSchema = z.strictObject({
	accountId: nonEmpty.optional(),
	query: nonEmpty.optional(),
	teamId: nonEmpty.optional(),
	refresh: z.boolean().optional(),
});

const linearGetIssueSchema = z.strictObject({
	accountId: nonEmpty.optional(),
	issueId: nonEmpty,
	refresh: z.boolean().optional(),
});

const linearGetMetadataSchema = z.strictObject({
	accountId: nonEmpty.optional(),
	refresh: z.boolean().optional(),
});

const linearCreateCommentSchema = z.strictObject({
	accountId: nonEmpty.optional(),
	issueId: nonEmpty,
	commentBody: nonEmpty.max(LINEAR_AGENT_LIMITS.maxCommentLength),
});

const LINEAR_UPDATE_FIELDS = [
	'stateId',
	'assigneeId',
	'priority',
	'title',
	'description',
] as const;

// Linear's own priority scale, not a rank the app invented: 0 none, 1 urgent,
// 2 high, 3 medium, 4 low. Anything outside it is silently ignored by the API.
const linearPriority = z.number().int().min(0).max(4);

const linearCreateIssueSchema = z.strictObject({
	accountId: nonEmpty.optional(),
	assigneeId: nonEmpty.optional(),
	description: z
		.string()
		.max(LINEAR_AGENT_LIMITS.maxDescriptionLength)
		.optional(),
	labelIds: z.array(nonEmpty).max(LINEAR_AGENT_LIMITS.maxLabelIds).optional(),
	priority: linearPriority.optional(),
	projectId: nonEmpty.optional(),
	stateId: nonEmpty.optional(),
	teamId: nonEmpty,
	title: nonEmpty.max(LINEAR_AGENT_LIMITS.maxTitleLength),
});

const linearUpdateIssueSchema = z
	.strictObject({
		accountId: nonEmpty.optional(),
		issueId: nonEmpty,
		stateId: nonEmpty.optional(),
		assigneeId: nonEmpty.optional(),
		priority: linearPriority.optional(),
		title: nonEmpty.max(LINEAR_AGENT_LIMITS.maxTitleLength).optional(),
		description: z
			.string()
			.max(LINEAR_AGENT_LIMITS.maxDescriptionLength)
			.optional(),
	})
	.refine(
		(args) => LINEAR_UPDATE_FIELDS.some((field) => args[field] !== undefined),
		{
			message: `Pass at least one field to change: ${LINEAR_UPDATE_FIELDS.join(', ')}.`,
		},
	);

const waitForAgentsSchema = z.strictObject({
	targets: z.array(nonEmpty).optional(),
	mode: z.enum(['first', 'all']).optional(),
	reports: z.enum(['full', 'brief']).optional(),
	timeoutMs: z.number().int().positive().optional(),
});

const notifyOrchestratorSchema = z.strictObject({
	reason: z.enum(['need_decision', 'blocked', 'progress', 'done']),
	message: nonEmpty,
});

// No session id: the Concierge conversation is cleared and restarted routinely,
// so an id the agent captured at spawn time names a session that is gone. The
// app resolves the live one at delivery instead, which is why there is nothing
// here for a caller to get wrong.
const messageConciergeSchema = z.strictObject({
	message: nonEmpty.max(CONCIERGE_MESSAGE_LIMITS.maxMessageLength),
	reason: z.enum(CONCIERGE_MESSAGE_REASONS),
});

const reservedLabels: ReadonlySet<string> = new Set(
	ASK_USER_QUESTION_RESERVED_LABELS,
);

const askUserQuestionOptionSchema = z.strictObject({
	label: nonEmpty
		.max(ASK_USER_QUESTION_LIMITS.maxLabelLength)
		.refine((label) => !reservedLabels.has(label.toLowerCase()), {
			message: 'Label is reserved by the dialog; choose a different wording.',
		}),
	description: nonEmpty
		.transform((description) =>
			description.slice(0, ASK_USER_QUESTION_LIMITS.maxDescriptionLength),
		)
		.optional(),
});

const askUserQuestionItemSchema = z.strictObject({
	question: nonEmpty,
	header: nonEmpty
		.transform((header) =>
			header.slice(0, ASK_USER_QUESTION_LIMITS.maxHeaderLength),
		)
		.optional(),
	options: z
		.array(askUserQuestionOptionSchema)
		.min(ASK_USER_QUESTION_LIMITS.minOptions)
		.max(ASK_USER_QUESTION_LIMITS.maxOptions)
		.refine(
			(options) =>
				new Set(options.map((option) => option.label.toLowerCase())).size ===
				options.length,
			{ message: 'Option labels must be distinct.' },
		),
	multiSelect: z.boolean().optional(),
});

const askUserQuestionSchema = z.strictObject({
	questions: z
		.array(askUserQuestionItemSchema)
		.min(1)
		.max(ASK_USER_QUESTION_LIMITS.maxQuestions)
		.refine(
			(questions) =>
				new Set(questions.map((item) => item.question.toLowerCase())).size ===
				questions.length,
			{ message: 'Questions must be distinct.' },
		),
});

const checkPlanModeToolSchema = z.strictObject({
	tool: nonEmpty,
	command: z.string().optional(),
	path: z.string().optional(),
});

const exitPlanModeSchema = z.strictObject({
	title: nonEmpty.max(EXIT_PLAN_MODE_LIMITS.maxTitleLength),
	plan: nonEmpty.max(EXIT_PLAN_MODE_LIMITS.maxPlanLength),
});

const emptySchema = z.strictObject({});

/** Per-operation argument validators, keyed by {@link AgentControlOp}. */
const AGENT_CONTROL_ARG_SCHEMAS = {
	spawnChatTab: spawnChatTabSchema,
	startConversation: startConversationSchema,
	sendFollowUp: sendFollowUpSchema,
	setName: setNameSchema,
	setBranchName: setBranchNameSchema,
	setSummary: setSummarySchema,
	getArchitectureDiagram: emptySchema,
	updateArchitectureDiagram: updateArchitectureDiagramSchema,
	closeTab: closeTabSchema,
	launchHarness: launchHarnessSchema,
	startTerminal: startTerminalSchema,
	stopTerminal: stopTerminalSchema,
	writeTerminal: writeTerminalSchema,
	openTab: openTabSchema,
	focusTab: focusTabSchema,
	focusDockTab: focusDockTabSchema,
	focusPanel: focusPanelSchema,
	focusWorkspace: focusWorkspaceSchema,
	createWorkspace: createWorkspaceSchema,
	recallMemory: recallMemorySchema,
	setWorkspaceStatus: setWorkspaceStatusSchema,
	getWorkspaceStatus: getWorkspaceStatusSchema,
	getWorkspaceDiff: getWorkspaceDiffSchema,
	getDiffComments: getDiffCommentsSchema,
	addDiffComments: addDiffCommentsSchema,
	resolveDiffComments: resolveDiffCommentsSchema,
	linearListIssues: linearListIssuesSchema,
	linearGetIssue: linearGetIssueSchema,
	linearGetMetadata: linearGetMetadataSchema,
	linearCreateComment: linearCreateCommentSchema,
	linearCreateIssue: linearCreateIssueSchema,
	linearUpdateIssue: linearUpdateIssueSchema,
	listProjects: emptySchema,
	listWorkspaces: emptySchema,
	listTabs: listTabsSchema,
	listTerminals: listTerminalsSchema,
	getConversationStatus: conversationRefSchema,
	getLastMessage: conversationRefSchema,
	readConversation: readConversationSchema,
	readTerminalOutput: readTerminalOutputSchema,
	listModels: emptySchema,
	listRunScripts: emptySchema,
	waitForAgents: waitForAgentsSchema,
	notifyOrchestrator: notifyOrchestratorSchema,
	messageConcierge: messageConciergeSchema,
	askUserQuestion: askUserQuestionSchema,
	getSessionBrief: emptySchema,
	checkPlanModeTool: checkPlanModeToolSchema,
	exitPlanMode: exitPlanModeSchema,
} satisfies Record<AgentControlOp, z.ZodType>;

/**
 * The argument keys an op accepts, read off its own schema — every one here is
 * an object schema, refined or not, so its shape is the vocabulary the boundary
 * really enforces. The naming-conformance and cross-surface parity tests measure
 * against this rather than a hand-kept list that could drift from it.
 * @param op - Operation whose vocabulary to read.
 * @returns Its argument keys, sorted.
 */
export const argKeysForOp = (op: AgentControlOp): readonly string[] =>
	Object.keys(
		(AGENT_CONTROL_ARG_SCHEMAS[op] as unknown as { shape: object }).shape,
	).sort();

const askUserQuestionAnswerSchema = z.strictObject({
	questionIndex: z.number().int().min(0),
	question: nonEmpty,
	kind: z.enum(['option', 'custom', 'multi']),
	answer: z.string().nullable(),
	selected: z.array(z.string()).optional(),
});

const askUserQuestionReplySchema = z.strictObject({
	requestId: nonEmpty,
	answers: z.array(askUserQuestionAnswerSchema),
	cancelled: z.boolean(),
});

/**
 * Validates a renderer-supplied answer to a pending questionnaire before it
 * settles an agent's blocked control call.
 * @param raw - Untrusted reply payload from the renderer.
 * @returns The parsed reply, or null when the payload is malformed.
 */
export function parseAskUserQuestionReply(
	raw: unknown,
): AskUserQuestionReply | null {
	const parsed = askUserQuestionReplySchema.safeParse(raw);
	return parsed.success ? parsed.data : null;
}

/** Parsed argument type for a given operation, inferred from its schema. */
export type ArgsForOp<Op extends AgentControlOp> = z.infer<
	(typeof AGENT_CONTROL_ARG_SCHEMAS)[Op]
>;

/** Outcome of validating raw op args: parsed value or a reason string. */
export type ValidateArgsResult<Op extends AgentControlOp> =
	| { ok: true; value: ArgsForOp<Op> }
	| { ok: false; reason: string };

/**
 * Names the keys an op does accept, to close a failure caused by one it does
 * not. The agent cannot see the schema, so a bare "unrecognized key" leaves it
 * guessing a second word where naming the vocabulary settles the retry.
 * @param op - Operation whose schema rejected the args.
 * @param issues - Validation issues the parse produced.
 * @returns A trailing sentence, or an empty string when no key was unrecognized.
 */
const describeAcceptedKeys = (
	op: AgentControlOp,
	issues: readonly { code: string }[],
): string => {
	const accepted = argKeysForOp(op);
	const rejectedAKey = issues.some(
		(issue) => issue.code === 'unrecognized_keys',
	);
	return rejectedAKey && accepted.length > 0
		? `. This op accepts: ${accepted.join(', ')}.`
		: '';
};

/**
 * Validates raw agent-supplied args for an operation against its schema,
 * returning the args typed to that op so callers avoid an unsafe cast. Known
 * near-miss keys are rewritten to their canonical name first, so a model that
 * reached for the wrong word keeps its turn.
 * @param op - Operation whose schema to apply.
 * @param rawArgs - Untrusted argument object from the agent.
 * @returns The parsed value on success, or a human-readable reason on failure.
 */
export function validateArgs<Op extends AgentControlOp>(
	op: Op,
	rawArgs: unknown,
): ValidateArgsResult<Op> {
	const schema = AGENT_CONTROL_ARG_SCHEMAS[op];
	const parsed = schema.safeParse(canonicalizeArgs(op, rawArgs ?? {}));
	if (parsed.success) {
		return { ok: true, value: parsed.data as ArgsForOp<Op> };
	}
	const reason = parsed.error.issues
		.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('; ');
	return {
		ok: false,
		reason: `${reason}${describeAcceptedKeys(op, parsed.error.issues)}`,
	};
}
