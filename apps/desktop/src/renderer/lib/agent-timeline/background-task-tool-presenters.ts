import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import {
	inputOf,
	numberField,
	outputOf,
	stringField,
} from './tool-part-fields';

/** Icon assignments for every public pi-background-tasks tool. */
export const BACKGROUND_TASK_TOOL_GLYPHS = {
	bg_delegate: 'bot',
	bg_kill: 'circle-stop',
	bg_logs: 'terminal',
	bg_result: 'scroll-text',
	bg_run: 'play',
	bg_run_pi_attested: 'play',
	bg_status: 'stethoscope',
	fusion_investigate: 'search',
	fusion_reason: 'brain',
	fusion_research: 'network',
	fusion_validate: 'stethoscope',
} satisfies Record<string, ToolGlyph>;

/** Narrows an untrusted value to a plain record. */
function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Builds a collapsed summary from present values.
 * @param values - Optional values in display order
 * @param font - Typography for prose or machine-readable content
 * @returns A preview, or null when every value is absent
 */
function backgroundPreview(
	values: readonly (string | null)[],
	font: 'mono' | 'sans' = 'sans',
): ToolPreviewDescriptor | null {
	const visible = values.filter((value): value is string => value !== null);
	return visible.length === 0 ? null : { font, text: visible.join(' · ') };
}

/**
 * Formats a byte count compactly for a timeline preview.
 * @param bytes - Byte count to format
 * @returns Human-readable byte count, or null when absent
 */
function formatBytes(bytes: number | null): string | null {
	if (bytes === null) {
		return null;
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}
	return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Localizes stable task and delivery state codes for compact previews.
 * @param state - State code emitted by pi-background-tasks
 * @returns Localized state, or null when absent
 */
function localizedState(state: string | null): string | null {
	const labels: Readonly<Record<string, string>> = {
		artifact: i18n.t(
			'workbench:tool-call.background-tasks.state.artifact',
			'artifact',
		),
		cancelled: i18n.t(
			'workbench:tool-call.background-tasks.state.cancelled',
			'cancelled',
		),
		committed: i18n.t(
			'workbench:tool-call.background-tasks.state.committed',
			'ready',
		),
		completed: i18n.t(
			'workbench:tool-call.background-tasks.state.completed',
			'completed',
		),
		failed: i18n.t(
			'workbench:tool-call.background-tasks.state.failed',
			'failed',
		),
		inline: i18n.t(
			'workbench:tool-call.background-tasks.state.inline',
			'inline',
		),
		killed: i18n.t(
			'workbench:tool-call.background-tasks.state.killed',
			'stopped',
		),
		none: i18n.t(
			'workbench:tool-call.background-tasks.state.none',
			'not ready',
		),
		running: i18n.t(
			'workbench:tool-call.background-tasks.state.running',
			'running',
		),
	};
	return state === null ? null : (labels[state] ?? state);
}

/**
 * Reads task metadata shared by launch, status, log, and stop results.
 * @param part - Background task tool part
 * @returns Task details when available
 */
function taskOf(part: DynamicToolUIPart): Record<string, unknown> {
	return record(outputOf(part)?.details?.task);
}

/**
 * Selects a readable background-task body without repeating the input object.
 * @param part - Background task tool part
 * @param kind - Successful body treatment
 * @returns Body and tone for the result
 */
function backgroundBody(
	part: DynamicToolUIPart,
	kind: 'markdown' | 'terminal' = 'markdown',
): { body: ToolBodyDescriptor; tone: ToolPresenterResult['tone'] } {
	const output = outputOf(part);
	const text = output?.text ?? '';
	const details = output?.details ?? {};
	const state = stringField(details, 'state');
	const error =
		stringField(details, 'error') ?? stringField(taskOf(part), 'error');
	if (error !== null || state === 'failed' || state === 'cancelled') {
		return {
			body: { kind: 'error', text: text || error || state || '' },
			tone: 'destructive',
		};
	}
	if (text.length === 0) {
		return { body: { kind: 'empty' }, tone: 'default' };
	}
	return {
		body:
			kind === 'terminal'
				? { kind: 'terminal', text }
				: { kind: 'markdown', text },
		tone: 'default',
	};
}

/**
 * Presents a background task launch receipt.
 * @param part - `bg_run` tool part
 * @returns Launch title, task summary, and receipt
 */
function presentBackgroundRun(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const task = taskOf(part);
	return {
		badge: null,
		...backgroundBody(part),
		preview: backgroundPreview([
			stringField(task, 'name') ?? stringField(input, 'name', 'description'),
			stringField(task, 'id'),
			localizedState(stringField(task, 'status')),
		]),
		title: i18n.t(
			'workbench:tool-call.background-tasks.run-title',
			'Start background task',
		),
	};
}

/**
 * Presents an attested Pi task launch receipt.
 * @param part - `bg_run_pi_attested` tool part
 * @returns Attested launch title, route summary, and receipt
 */
function presentAttestedRun(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const task = taskOf(part);
	const route = [stringField(input, 'provider'), stringField(input, 'model')]
		.filter((value): value is string => value !== null)
		.join('/');
	return {
		badge: null,
		...backgroundBody(part),
		preview: backgroundPreview([
			stringField(task, 'name') ?? stringField(input, 'name'),
			route || null,
			stringField(task, 'id'),
		]),
		title: i18n.t(
			'workbench:tool-call.background-tasks.attested-title',
			'Start attested Pi run',
		),
	};
}

/**
 * Presents a point-in-time task status read.
 * @param part - `bg_status` tool part
 * @returns Status title, task count, and terminal-style snapshot
 */
function presentBackgroundStatus(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const tasks = Array.isArray(details.tasks) ? details.tasks : [];
	const taskCount = tasks.length;
	const count =
		taskCount === 0
			? null
			: i18n.t('workbench:tool-call.background-tasks.task-count', {
					count: taskCount,
					defaultValue_one: '{{count}} task',
					defaultValue_other: '{{count}} tasks',
				});
	return {
		badge: null,
		...backgroundBody(part, 'terminal'),
		preview: backgroundPreview([stringField(input, 'taskId'), count], 'mono'),
		title: i18n.t(
			'workbench:tool-call.background-tasks.status-title',
			'Check background tasks',
		),
	};
}

/**
 * Presents bounded task output in the terminal treatment it already speaks.
 * @param part - `bg_logs` tool part
 * @returns Log title, range summary, and terminal output
 */
function presentBackgroundLogs(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const task = taskOf(part);
	const tail =
		details.tail === false
			? i18n.t('workbench:tool-call.background-tasks.head', 'head')
			: i18n.t('workbench:tool-call.background-tasks.tail', 'tail');
	const truncated =
		details.truncated === true
			? i18n.t('workbench:tool-call.background-tasks.truncated', 'truncated')
			: null;
	return {
		badge: null,
		...backgroundBody(part, 'terminal'),
		preview: backgroundPreview(
			[
				stringField(task, 'name'),
				stringField(task, 'id') ?? stringField(input, 'taskId'),
				formatBytes(numberField(details, 'bytesRead')),
				tail,
				truncated,
			],
			'mono',
		),
		title: i18n.t(
			'workbench:tool-call.background-tasks.logs-title',
			'Read background logs',
		),
	};
}

/**
 * Presents a task stop result.
 * @param part - `bg_kill` tool part
 * @returns Stop title, task summary, and receipt
 */
function presentBackgroundKill(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const task = taskOf(part);
	return {
		badge: null,
		...backgroundBody(part),
		preview: backgroundPreview([
			stringField(task, 'name'),
			stringField(task, 'id') ?? stringField(input, 'taskId'),
			localizedState(stringField(task, 'status')),
		]),
		title: i18n.t(
			'workbench:tool-call.background-tasks.kill-title',
			'Stop background task',
		),
	};
}

/**
 * Presents a delegated-agent launch receipt.
 * @param part - `bg_delegate` tool part
 * @returns Delegation title, route summary, and receipt
 */
function presentBackgroundDelegate(
	part: DynamicToolUIPart,
): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const route = record(details.route);
	return {
		badge: null,
		...backgroundBody(part),
		preview: backgroundPreview([
			stringField(input, 'name'),
			stringField(details, 'task_id') ?? stringField(taskOf(part), 'id'),
			stringField(route, 'qualified_id'),
		]),
		title: i18n.t(
			'workbench:tool-call.background-tasks.delegate-title',
			'Delegate in background',
		),
	};
}

/**
 * Presents a verified delegate or Fusion result.
 * @param part - `bg_result` tool part
 * @returns Result title, delivery summary, and answer
 */
function presentBackgroundResult(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	return {
		badge: null,
		...backgroundBody(part),
		preview: backgroundPreview([
			stringField(details, 'task_id') ?? stringField(input, 'taskId'),
			localizedState(stringField(details, 'state')),
			localizedState(stringField(details, 'delivery')),
			formatBytes(numberField(details, 'answer_bytes')),
		]),
		title: i18n.t(
			'workbench:tool-call.background-tasks.result-title',
			'Read background result',
		),
	};
}

/**
 * Localizes a Fusion workflow's activity title.
 * @param toolName - Fusion tool name
 * @returns Localized workflow title
 */
function fusionTitle(toolName: string): string {
	switch (toolName.toLowerCase()) {
		case 'fusion_investigate':
			return i18n.t(
				'workbench:tool-call.background-tasks.fusion-investigate-title',
				'Start Fusion investigation',
			);
		case 'fusion_reason':
			return i18n.t(
				'workbench:tool-call.background-tasks.fusion-reason-title',
				'Start Fusion reasoning',
			);
		case 'fusion_research':
			return i18n.t(
				'workbench:tool-call.background-tasks.fusion-research-title',
				'Start Fusion research',
			);
		case 'fusion_validate':
			return i18n.t(
				'workbench:tool-call.background-tasks.fusion-validate-title',
				'Start Fusion validation',
			);
		default:
			return i18n.t(
				'workbench:tool-call.background-tasks.fusion-title',
				'Start Fusion workflow',
			);
	}
}

/**
 * Presents one Fusion workflow launch.
 * @param part - Fusion tool part
 * @returns Workflow title, objective summary, and launch receipt
 */
function presentFusion(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	return {
		badge: null,
		...backgroundBody(part),
		preview: backgroundPreview([
			stringField(input, 'objective', 'prompt'),
			stringField(details, 'task_id') ?? stringField(taskOf(part), 'id'),
			stringField(details, 'workflow'),
		]),
		title: fusionTitle(part.toolName),
	};
}

/** Dedicated presenters for the complete pi-background-tasks tool surface. */
export const BACKGROUND_TASK_TOOL_PRESENTERS = {
	bg_delegate: presentBackgroundDelegate,
	bg_kill: presentBackgroundKill,
	bg_logs: presentBackgroundLogs,
	bg_result: presentBackgroundResult,
	bg_run: presentBackgroundRun,
	bg_run_pi_attested: presentAttestedRun,
	bg_status: presentBackgroundStatus,
	fusion_investigate: presentFusion,
	fusion_reason: presentFusion,
	fusion_research: presentFusion,
	fusion_validate: presentFusion,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
