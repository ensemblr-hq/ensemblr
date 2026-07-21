/**
 * Zod validators for agent-control operation arguments. Agents are untrusted
 * input, so every op's args are parsed at the service boundary before anything
 * runs. Each schema is keyed by its {@link AgentControlOp} in {@link AGENT_CONTROL_ARG_SCHEMAS}.
 */
import { z } from 'zod';

import type { AgentControlOp } from './contracts.ts';

const nonEmpty = z.string().trim().min(1);

const spawnChatTabSchema = z
	.object({
		title: nonEmpty.optional(),
	})
	.strict();

const startConversationSchema = z
	.object({
		chatTabId: nonEmpty.optional(),
		prompt: nonEmpty,
		model: nonEmpty.optional(),
		thinkingLevel: nonEmpty.optional(),
		wait: z.boolean().optional(),
	})
	.strict();

const sendFollowUpSchema = z
	.object({
		piSessionId: nonEmpty,
		prompt: nonEmpty,
		wait: z.boolean().optional(),
	})
	.strict();

const closeTabSchema = z
	.object({
		chatTabId: nonEmpty,
	})
	.strict();

const launchHarnessSchema = z
	.object({
		harnessId: nonEmpty,
	})
	.strict();

const startTerminalSchema = z
	.object({
		kind: z.enum(['setup', 'run', 'spawn']),
	})
	.strict();

const terminalIdOrKindSchema = z
	.object({
		terminalId: nonEmpty.optional(),
		kind: z.enum(['setup', 'run']).optional(),
	})
	.strict()
	.refine((value) => Boolean(value.terminalId) !== Boolean(value.kind), {
		message: 'Provide exactly one of terminalId or kind.',
	});

const stopTerminalSchema = terminalIdOrKindSchema;

const writeTerminalSchema = z
	.object({
		terminalId: nonEmpty,
		input: z.string().min(1),
	})
	.strict();

const openTabSchema = z
	.object({
		variant: z.enum(['file', 'diff', 'comment']),
		filePath: nonEmpty.optional(),
		turnId: nonEmpty.optional(),
		commentBody: nonEmpty.optional(),
		prNumber: z.number().int().positive().optional(),
	})
	.strict()
	.refine(
		(value) =>
			value.variant === 'comment'
				? Boolean(value.commentBody)
				: Boolean(value.filePath),
		{ message: 'file/diff tabs need filePath; comment tabs need commentBody.' },
	);

const listTabsSchema = z
	.object({
		workspaceId: nonEmpty.optional(),
	})
	.strict();

const listTerminalsSchema = z
	.object({
		workspaceId: nonEmpty.optional(),
	})
	.strict();

const conversationRefSchema = z
	.object({
		piSessionId: nonEmpty,
	})
	.strict();

const readTerminalOutputSchema = z
	.object({
		terminalId: nonEmpty,
	})
	.strict();

const focusTabSchema = z
	.object({
		chatTabId: nonEmpty,
	})
	.strict();

const focusDockTabSchema = terminalIdOrKindSchema;

const focusPanelSchema = z
	.object({
		panel: z.enum(['files', 'changes', 'checks']),
	})
	.strict();

const waitForAgentsSchema = z
	.object({
		targets: z.array(nonEmpty).optional(),
		mode: z.enum(['first', 'all']).optional(),
		timeoutMs: z.number().int().positive().optional(),
	})
	.strict();

const notifyOrchestratorSchema = z
	.object({
		reason: z.enum(['need_decision', 'blocked', 'progress', 'done']),
		message: nonEmpty,
	})
	.strict();

const emptySchema = z.object({}).strict();

/** Per-operation argument validators, keyed by {@link AgentControlOp}. */
export const AGENT_CONTROL_ARG_SCHEMAS = {
	spawnChatTab: spawnChatTabSchema,
	startConversation: startConversationSchema,
	sendFollowUp: sendFollowUpSchema,
	closeTab: closeTabSchema,
	launchHarness: launchHarnessSchema,
	startTerminal: startTerminalSchema,
	stopTerminal: stopTerminalSchema,
	writeTerminal: writeTerminalSchema,
	openTab: openTabSchema,
	focusTab: focusTabSchema,
	focusDockTab: focusDockTabSchema,
	focusPanel: focusPanelSchema,
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
