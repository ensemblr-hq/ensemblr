/**
 * Zod validators for agent-control operation arguments. Agents are untrusted
 * input, so every op's args are parsed at the service boundary before anything
 * runs. Each schema is keyed by its {@link AgentControlOp} in {@link AGENT_CONTROL_ARG_SCHEMAS}.
 */
import { z } from 'zod';

import type { AskUserQuestionReply } from './contracts.ts';
import {
	type AgentControlOp,
	ASK_USER_QUESTION_LIMITS,
	ASK_USER_QUESTION_RESERVED_LABELS,
	DIFF_COMMENT_LIMITS,
	EXIT_PLAN_MODE_LIMITS,
	SET_BRANCH_NAME_LIMITS,
	SET_SUMMARY_LIMITS,
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

const startConversationSchema = z.strictObject({
	chatTabId: nonEmpty.optional(),
	prompt: nonEmpty,
	model: nonEmpty.optional(),
	thinkingLevel: nonEmpty.optional(),
	title: nonEmpty.optional(),
	wait: z.boolean().optional(),
});

const setNameSchema = z.strictObject({
	name: nonEmpty,
});

const setBranchNameSchema = z.strictObject({
	name: nonEmpty.max(SET_BRANCH_NAME_LIMITS.maxRawLength),
});

const setSummarySchema = z.strictObject({
	title: nonEmpty.max(SET_SUMMARY_LIMITS.maxTitleLength),
	summary: nonEmpty.max(SET_SUMMARY_LIMITS.maxSummaryLength),
});

const sendFollowUpSchema = z.strictObject({
	piSessionId: nonEmpty,
	prompt: nonEmpty,
	wait: z.boolean().optional(),
});

const closeTabSchema = z.strictObject({
	chatTabId: nonEmpty,
});

const launchHarnessSchema = z.strictObject({
	harnessId: nonEmpty,
});

const startTerminalSchema = z.strictObject({
	kind: z.enum(['setup', 'run', 'spawn']),
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
	piSessionId: nonEmpty,
});

const readConversationSchema = z.strictObject({
	piSessionId: nonEmpty,
	stat: z.boolean().optional(),
	fromOrdinal: z.number().int().min(0).optional(),
	ordinal: z.number().int().min(0).optional(),
});

const readTerminalOutputSchema = z.strictObject({
	terminalId: nonEmpty,
});

const focusTabSchema = z.strictObject({
	chatTabId: nonEmpty,
});

const focusDockTabSchema = terminalIdOrKindSchema;

const focusPanelSchema = z.strictObject({
	panel: z.enum(['files', 'changes', 'checks']),
});

const setWorkspaceStatusSchema = z.strictObject({
	status: z.enum(WORKSPACE_BOARD_STATUSES),
});

const getWorkspaceDiffSchema = z
	.strictObject({
		file: workspaceRelativePath.optional(),
		stat: z.boolean().optional(),
	})
	// Reading one file already knows which file it wants, so a stat alongside it
	// is a contradiction rather than a refinement. Rejecting says which of the two
	// the caller is going to get; silent precedence leaves it guessing.
	.refine((args) => !(args.file && args.stat), {
		message: 'Pass either file or stat, not both: a single file has no stat.',
	});

const getDiffCommentsSchema = z.strictObject({
	file: workspaceRelativePath.optional(),
});

const addDiffCommentsSchema = z.strictObject({
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

const reservedLabels: ReadonlySet<string> = new Set(
	ASK_USER_QUESTION_RESERVED_LABELS,
);

const askUserQuestionOptionSchema = z.strictObject({
	label: nonEmpty
		.max(ASK_USER_QUESTION_LIMITS.maxLabelLength)
		.refine((label) => !reservedLabels.has(label.toLowerCase()), {
			message: 'Label is reserved by the dialog; choose a different wording.',
		}),
	description: nonEmpty.optional(),
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
	closeTab: closeTabSchema,
	launchHarness: launchHarnessSchema,
	startTerminal: startTerminalSchema,
	stopTerminal: stopTerminalSchema,
	writeTerminal: writeTerminalSchema,
	openTab: openTabSchema,
	focusTab: focusTabSchema,
	focusDockTab: focusDockTabSchema,
	focusPanel: focusPanelSchema,
	setWorkspaceStatus: setWorkspaceStatusSchema,
	getWorkspaceStatus: emptySchema,
	getWorkspaceDiff: getWorkspaceDiffSchema,
	getDiffComments: getDiffCommentsSchema,
	addDiffComments: addDiffCommentsSchema,
	listWorkspaces: emptySchema,
	listTabs: listTabsSchema,
	listTerminals: listTerminalsSchema,
	getConversationStatus: conversationRefSchema,
	getLastMessage: conversationRefSchema,
	readConversation: readConversationSchema,
	readTerminalOutput: readTerminalOutputSchema,
	listModels: emptySchema,
	waitForAgents: waitForAgentsSchema,
	notifyOrchestrator: notifyOrchestratorSchema,
	askUserQuestion: askUserQuestionSchema,
	getSessionBrief: emptySchema,
	checkPlanModeTool: checkPlanModeToolSchema,
	exitPlanMode: exitPlanModeSchema,
} satisfies Record<AgentControlOp, z.ZodType>;

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
 * Validates raw agent-supplied args for an operation against its schema,
 * returning the args typed to that op so callers avoid an unsafe cast.
 * @param op - Operation whose schema to apply.
 * @param rawArgs - Untrusted argument object from the agent.
 * @returns The parsed value on success, or a human-readable reason on failure.
 */
export function validateArgs<Op extends AgentControlOp>(
	op: Op,
	rawArgs: unknown,
): ValidateArgsResult<Op> {
	const schema = AGENT_CONTROL_ARG_SCHEMAS[op];
	const parsed = schema.safeParse(rawArgs ?? {});
	if (parsed.success) {
		return { ok: true, value: parsed.data as ArgsForOp<Op> };
	}
	const reason = parsed.error.issues
		.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('; ');
	return { ok: false, reason };
}
