/**
 * Zod validators for agent-control operation arguments. Agents are untrusted
 * input, so every op's args are parsed at the service boundary before anything
 * runs. Each schema is keyed by its {@link AgentControlOp} in {@link AGENT_CONTROL_ARG_SCHEMAS}.
 */
import { z } from 'zod';

import { type AgentControlOp, WORKSPACE_BOARD_STATUSES } from './contracts.ts';

const nonEmpty = z.string().trim().min(1);

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

const waitForAgentsSchema = z.strictObject({
	targets: z.array(nonEmpty).optional(),
	mode: z.enum(['first', 'all']).optional(),
	timeoutMs: z.number().int().positive().optional(),
});

const notifyOrchestratorSchema = z.strictObject({
	reason: z.enum(['need_decision', 'blocked', 'progress', 'done']),
	message: nonEmpty,
});

const emptySchema = z.strictObject({});

/** Per-operation argument validators, keyed by {@link AgentControlOp}. */
const AGENT_CONTROL_ARG_SCHEMAS = {
	spawnChatTab: spawnChatTabSchema,
	startConversation: startConversationSchema,
	sendFollowUp: sendFollowUpSchema,
	setName: setNameSchema,
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
	listWorkspaces: emptySchema,
	listTabs: listTabsSchema,
	listTerminals: listTerminalsSchema,
	getConversationStatus: conversationRefSchema,
	getLastMessage: conversationRefSchema,
	readTerminalOutput: readTerminalOutputSchema,
	listModels: emptySchema,
	waitForAgents: waitForAgentsSchema,
	notifyOrchestrator: notifyOrchestratorSchema,
} satisfies Record<AgentControlOp, z.ZodType>;

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
