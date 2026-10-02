import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type { ToolPanelSectionDescriptor } from '@/renderer/types/tool-presentation';
import {
	blockSafeExcerpt,
	bold,
	type ControlRow,
	clamp,
	codeFence,
	codeSpan,
	contextUsageText,
	controlAck,
	controlPayloadRecord,
	controlPayloadRows,
	excerpt,
	isRecord,
	joinFacts,
	listRow,
	markdownBlocks,
	markdownList,
	markdownRow,
	numberValue,
	omittedLine,
	REPORT_EXCERPT_LIMIT,
	ROW_EXCERPT_LIMIT,
	stringValue,
} from './ensemblr-control-presenter-helpers';

/**
 * How the delegation and conversation control ops read once a row is opened.
 *
 * These are the rows an orchestrating turn produces most of, and the ones whose
 * payloads reward being read: what a wait came back with, how full a child's
 * window is, what a transcript holds. Each presenter here supplies only the
 * body and the collapsed preview — the title, glyph, and chip stay with
 * `ensemblr-control-tool-registry.ts`, which already resolves them against the
 * surface and the target's role.
 *
 * The rule the family follows: the registry's `detailKeys` surface what was
 * *asked for*, so a preview here surfaces what came *back*. A preview that
 * repeated the title would cost the row a line and say nothing.
 */

/** Longest a tool call's recorded input runs inside a transcript entry. */
const TRANSCRIPT_INPUT_LIMIT = 400;

/** Longest a tool call's recorded output runs inside a transcript entry. */
const TRANSCRIPT_OUTPUT_LIMIT = 800;

/**
 * Renders one settled child of a wait: how it ended, what it signalled, how
 * full its window is, and enough of its report to tell whether it needs reading
 * in full.
 * @param agent - One untrusted `WaitedAgent` row
 * @returns The rendered block, or null when the row carries no session id
 */
function completedAgentBlock(agent: unknown): string | null {
	if (!isRecord(agent)) {
		return null;
	}
	const sessionId = stringValue(agent, 'agentSessionId');
	if (sessionId === null) {
		return null;
	}
	const signal = isRecord(agent.signal) ? agent.signal : null;
	const heading = joinFacts([
		bold(stringValue(agent, 'status') ?? sessionId),
		signal === null
			? null
			: i18n.t('workbench:control-tool.wait.signal', 'signal: {{reason}}', {
					reason: stringValue(signal, 'reason') ?? '',
				}),
		contextUsageText(agent.contextUsage),
		agent.reportTruncated === true
			? i18n.t(
					'workbench:control-tool.wait.report-truncated',
					'report truncated',
				)
			: null,
	]);
	const report = stringValue(agent, 'lastMessage');
	const signalMessage = signal === null ? null : stringValue(signal, 'message');
	return [
		`- ${heading}`,
		signalMessage === null
			? null
			: `  > ${blockSafeExcerpt(signalMessage, ROW_EXCERPT_LIMIT)}`,
		report === null
			? null
			: `\n  ${blockSafeExcerpt(report, REPORT_EXCERPT_LIMIT)}`,
	]
		.filter((line): line is string => line !== null)
		.join('\n');
}

/**
 * Renders one child a wait returned without: what it is doing and how much room
 * it has left, which is what decides whether to wait again or retire it.
 * @param agent - One untrusted `PendingAgent` row
 * @returns The rendered row, or null when the row carries no session id
 */
function pendingAgentRow(agent: unknown): string | null {
	if (!isRecord(agent)) {
		return null;
	}
	const sessionId = stringValue(agent, 'agentSessionId');
	if (sessionId === null) {
		return null;
	}
	return joinFacts([
		bold(stringValue(agent, 'status') ?? sessionId),
		contextUsageText(agent.contextUsage),
	]);
}

/**
 * Reads one side of a wait result, tolerating a payload that reported neither.
 * @param payload - The wait payload
 * @param field - `completed` or `pending`
 * @returns The rows, in payload order
 */
function waitRows(
	payload: Record<string, unknown>,
	field: string,
): readonly unknown[] {
	const rows = payload[field];
	return Array.isArray(rows) ? rows : [];
}

/**
 * Builds the collapsed line for a wait: how many children settled, how many are
 * still working, and whether the wait window expired before they did.
 * @param completed - Settled children
 * @param pending - Children still running
 * @param timedOut - Whether the wait window expired
 * @returns The collapsed line
 */
function waitPreview(
	completed: readonly unknown[],
	pending: readonly unknown[],
	timedOut: boolean,
): string {
	return joinFacts([
		completed.length === 0
			? null
			: i18n.t('workbench:control-tool.preview.agents-settled', {
					count: completed.length,
					defaultValue_one: '{{count}} settled',
					defaultValue_other: '{{count}} settled',
				}),
		pending.length === 0
			? null
			: i18n.t('workbench:control-tool.preview.agents-pending', {
					count: pending.length,
					defaultValue_one: '{{count}} still working',
					defaultValue_other: '{{count}} still working',
				}),
		timedOut
			? i18n.t(
					'workbench:control-tool.preview.timed-out',
					'wait window expired',
				)
			: null,
	]);
}

/**
 * Presents a blocking wait on delegated children.
 *
 * This is the row an orchestrating turn produces most of, and the one the
 * generic shape served worst: a wait that expires with a child still running
 * rendered as one unwrapped line of JSON, with the note explaining that a
 * timeout is a lap of the loop rather than a fault buried at the end of it.
 * @param part - The `ensemblr_wait_for_agents` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentWaitForAgents(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const completed = waitRows(payload, 'completed');
	const pending = waitRows(payload, 'pending');
	const completedBlocks = completed.flatMap((agent) => {
		const block = completedAgentBlock(agent);
		return block === null ? [] : [block];
	});
	const pendingRows = pending.flatMap((agent) => {
		const row = pendingAgentRow(agent);
		return row === null ? [] : [row];
	});
	const body = markdownBlocks([
		completedBlocks.length === 0
			? null
			: markdownBlocks([
					`### ${i18n.t('workbench:control-tool.wait.settled-heading', 'Settled')}`,
					completedBlocks.join('\n'),
				]),
		pendingRows.length === 0
			? null
			: markdownBlocks([
					`### ${i18n.t('workbench:control-tool.wait.pending-heading', 'Still working')}`,
					markdownList(pendingRows),
				]),
		stringValue(payload, 'note'),
	]);
	return markdownRow(
		body,
		waitPreview(completed, pending, payload.timedOut === true),
	);
}

/**
 * Names one transcript step by what kind of step it was, so a replay reads as a
 * conversation rather than as a typed union.
 * @param kind - The entry's discriminant
 * @param entry - The entry, for the tool name a `tool` step carries
 * @returns The heading, or null when the kind is not one this family renders
 */
function transcriptHeading(
	kind: unknown,
	entry: Record<string, unknown>,
): string | null {
	switch (kind) {
		case 'prompt':
			return i18n.t('workbench:control-tool.transcript.prompt', 'Prompt');
		case 'message':
			return i18n.t('workbench:control-tool.transcript.answer', 'Answer');
		case 'error':
			return i18n.t('workbench:control-tool.transcript.error', 'Error');
		case 'tool':
			return i18n.t(
				'workbench:control-tool.transcript.tool',
				'Tool: {{name}}',
				{
					name: stringValue(entry, 'name') ?? '',
				},
			);
		default:
			return null;
	}
}

/**
 * Renders one transcript entry under its heading, fencing a tool step's
 * recorded input and output so neither can break out into the surrounding
 * prose.
 * @param entry - One untrusted `ConversationTranscriptEntry`
 * @returns The rendered block, or null when the entry has no readable kind
 */
function transcriptEntryBlock(entry: unknown): string | null {
	if (!isRecord(entry)) {
		return null;
	}
	const heading = transcriptHeading(entry.kind, entry);
	if (heading === null) {
		return null;
	}
	const ordinal = numberValue(entry, 'ordinal');
	const marker = ordinal === null ? '' : ` #${ordinal}`;
	if (entry.kind !== 'tool') {
		return markdownBlocks([
			`#### ${heading}${marker}`,
			stringValue(entry, 'text'),
		]);
	}
	const input = stringValue(entry, 'input');
	const output = stringValue(entry, 'output');
	return markdownBlocks([
		`#### ${heading}${marker}`,
		input === null ? null : codeFence(clamp(input, TRANSCRIPT_INPUT_LIMIT)),
		output === null ? null : codeFence(clamp(output, TRANSCRIPT_OUTPUT_LIMIT)),
	]);
}

/**
 * Names how much of a conversation there is, which is the whole answer a `stat`
 * probe asks for and the context every page of entries is read against.
 * @param payload - The read-conversation payload
 * @returns The rendered counts line, empty when the payload reported none
 */
function transcriptCounts(payload: Record<string, unknown>): string {
	const entryCount = numberValue(payload, 'entryCount');
	const turnCount = numberValue(payload, 'turnCount');
	return joinFacts([
		entryCount === null
			? null
			: i18n.t('workbench:control-tool.preview.entries', {
					count: entryCount,
					defaultValue_one: '{{count}} entry',
					defaultValue_other: '{{count}} entries',
				}),
		turnCount === null
			? null
			: i18n.t('workbench:control-tool.preview.turns', {
					count: turnCount,
					defaultValue_one: '{{count}} turn',
					defaultValue_other: '{{count}} turns',
				}),
	]);
}

/**
 * Presents a page of a conversation's persisted transcript.
 *
 * A `stat` probe carries counts and no entries, and is the call a caller is told
 * to make first — so an empty page is the expected shape rather than a missing
 * one, and renders as the counts alone.
 * @param part - The `ensemblr_read_conversation` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentReadConversation(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const entries = Array.isArray(payload.entries) ? payload.entries : [];
	const blocks = entries.flatMap((entry) => {
		const block = transcriptEntryBlock(entry);
		return block === null ? [] : [block];
	});
	const counts = transcriptCounts(payload);
	const body = markdownBlocks([
		blocks.length === 0 ? counts : null,
		...blocks,
		omittedLine(entries.length - blocks.length),
	]);
	return markdownRow(body, counts);
}

/**
 * Presents a child's final report. The payload is the whole closing turn as
 * prose, so it renders as markdown rather than as a field of a record.
 * @param part - The `ensemblr_get_last_message` tool part to project
 * @returns The row's body
 */
function presentGetLastMessage(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	const message = payload === null ? null : stringValue(payload, 'message');
	return message === null ? controlAck() : markdownRow(message, null);
}

/**
 * Presents a conversation's live status. Two short facts read better as
 * labelled fields than as a sentence, and how full the window is rides the
 * preview because it is the one an orchestrator scans for.
 * @param part - The `ensemblr_get_conversation_status` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentConversationStatus(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	if (payload === null) {
		return controlAck();
	}
	const sections: ToolPanelSectionDescriptor[] = [
		{
			label: i18n.t('workbench:control-tool.status.runtime-label', 'Runtime:'),
			muted: true,
			text:
				payload.runtimeOpen === true
					? i18n.t('workbench:control-tool.status.runtime-open', 'Open')
					: i18n.t('workbench:control-tool.status.runtime-closed', 'Closed'),
		},
		{
			label: i18n.t('workbench:control-tool.status.report-label', 'Report:'),
			muted: true,
			text:
				payload.hasFinalMessage === true
					? i18n.t(
							'workbench:control-tool.status.report-ready',
							'Ready to read',
						)
					: i18n.t('workbench:control-tool.status.report-none', 'None yet'),
		},
	];
	const note = stringValue(payload, 'note');
	const preview = joinFacts([
		stringValue(payload, 'status'),
		contextUsageText(payload.contextUsage),
	]);
	return {
		body: {
			kind: 'labeled',
			sections:
				note === null
					? sections
					: [
							...sections,
							{
								label: i18n.t(
									'workbench:control-tool.status.note-label',
									'Note:',
								),
								muted: false,
								text: note,
							},
						],
		},
		preview: preview.length === 0 ? null : { font: 'sans', text: preview },
	};
}

/**
 * Presents a memory recall. Each hit reads as its title, what kind of memory it
 * is, and enough of the match to judge it without opening the file.
 * @param part - The `ensemblr_recall_memory` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentRecallMemory(part: DynamicToolUIPart): ControlRow {
	const rows = controlPayloadRows(part, 'memories');
	if (rows === null) {
		return controlAck();
	}
	const rendered = rows.flatMap((memory) => {
		if (!isRecord(memory)) {
			return [];
		}
		const title = stringValue(memory, 'title');
		if (title === null) {
			return [];
		}
		const detail =
			stringValue(memory, 'summary') ?? stringValue(memory, 'snippet');
		const path = stringValue(memory, 'relativePath');
		return [
			joinFacts([
				bold(title),
				stringValue(memory, 'kind'),
				detail === null ? null : excerpt(detail, ROW_EXCERPT_LIMIT),
				path === null ? null : codeSpan(path),
			]),
		];
	});
	return listRow(
		rendered,
		i18n.t('workbench:control-tool.preview.memories', {
			count: rendered.length,
			defaultValue_one: '{{count}} memory',
			defaultValue_other: '{{count}} memories',
		}),
	);
}

/**
 * Presents the model catalogue a caller reads before choosing where to spawn a
 * child. Roles and tier are the two facts that decide the choice, so both ride
 * the row rather than the disclosure.
 * @param part - The `ensemblr_list_models` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentListModels(part: DynamicToolUIPart): ControlRow {
	const rows = controlPayloadRows(part, 'models');
	if (rows === null) {
		return controlAck();
	}
	const rendered = rows.flatMap((model) => {
		if (!isRecord(model)) {
			return [];
		}
		const id = stringValue(model, 'id');
		if (id === null) {
			return [];
		}
		const roles = Array.isArray(model.roles)
			? model.roles.filter((role): role is string => typeof role === 'string')
			: [];
		return [
			joinFacts([
				bold(stringValue(model, 'displayName') ?? id),
				codeSpan(id),
				stringValue(model, 'runtime'),
				stringValue(model, 'tier'),
				roles.length === 0 ? null : roles.join(', '),
			]),
		];
	});
	return listRow(
		rendered,
		i18n.t('workbench:control-tool.preview.models', {
			count: rendered.length,
			defaultValue_one: '{{count}} model',
			defaultValue_other: '{{count}} models',
		}),
	);
}

/** Session and delegation control ops, keyed by their canonical tool name. */
export const ENSEMBLR_SESSION_TOOL_PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ControlRow
> = {
	ensemblr_get_conversation_status: presentConversationStatus,
	ensemblr_get_last_message: presentGetLastMessage,
	ensemblr_list_models: presentListModels,
	ensemblr_read_conversation: presentReadConversation,
	ensemblr_recall_memory: presentRecallMemory,
	ensemblr_wait_for_agents: presentWaitForAgents,
};
