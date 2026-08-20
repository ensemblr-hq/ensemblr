import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolChecklistItem,
	ToolGlyph,
	ToolPresentation,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import {
	createdTaskNumber,
	normalizeTaskStatus,
	parseTaskDetail,
	parseTaskListItems,
} from './task-tool-payloads';
import { inputOf, outputOf, stringField } from './tool-part-fields';

/**
 * How Claude Code's task tools read in the timeline.
 *
 * `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, `TaskOutput`, and `TaskStop`
 * are harness tools rather than Ensemblr control ops, so they are presented here
 * and registered alongside `bash` and `read` in `tool-presenters.ts`. They are
 * held in their own module because they share a payload vocabulary — a task
 * number, a status word, a subject — that nothing else in the table speaks.
 *
 * The sub-agent `Task` tool is unrelated despite the shared prefix: it keeps its
 * own entry, and every name here is matched whole so no `Task*` verb can fall
 * into it.
 */

/** Separates the subjects a folded plan lists in its one-line preview. */
const SUBJECT_SEPARATOR = ' · ';

/** The mark each task verb answers to, keyed as `PRESENTERS` keys are. */
export const TASK_TOOL_GLYPHS: Record<string, ToolGlyph> = {
	taskcreate: 'clipboard-list',
	taskget: 'clipboard-list',
	tasklist: 'list',
	taskoutput: 'scroll-text',
	taskstop: 'circle-stop',
	taskupdate: 'message-square-check',
};

/**
 * Names the state a task moved to, in the active language.
 *
 * `deleted` is a transition rather than a resting state — a deleted task never
 * appears in a list again — so it is named here and not among the checklist's
 * own statuses. A word the harness invents later is passed through verbatim,
 * which reads better than calling a real transition unknown.
 * @param raw - The status word as the call's arguments spelled it
 * @returns The label to show, or the raw word when the app does not know it
 */
function taskStatusLabel(raw: string): string {
	if (raw.trim().toLowerCase() === 'deleted') {
		return i18n.t('workbench:tool-call.task.status.deleted', 'Deleted');
	}
	switch (normalizeTaskStatus(raw)) {
		case 'pending':
			return i18n.t('workbench:tool-call.task.status.pending', 'Pending');
		case 'in-progress':
			return i18n.t(
				'workbench:tool-call.task.status.in-progress',
				'In progress',
			);
		case 'completed':
			return i18n.t('workbench:tool-call.task.status.completed', 'Completed');
		default:
			return raw.trim();
	}
}

/**
 * Titles a row after the task it names, so a number the reader can act on stays
 * in front of the subject.
 * @param number - The task's number, or null when none is known yet
 * @param subject - The task's subject, or null when the call named none
 * @returns The row title
 */
function taskTitle(number: string | null, subject: string | null): string {
	if (subject === null) {
		return number === null
			? i18n.t('workbench:tool-call.task.title', 'Task')
			: i18n.t('workbench:tool-call.task.numbered-only', 'Task #{{number}}', {
					number,
				});
	}
	return number === null
		? i18n.t('workbench:tool-call.task.named', 'Task: {{subject}}', { subject })
		: i18n.t(
				'workbench:tool-call.task.numbered',
				'Task #{{number}}: {{subject}}',
				{ number, subject },
			);
}

/**
 * Titles a row after the state a task moved to, keeping the number in front of
 * it when the call named one.
 * @param number - The task's number, or null when the call named none
 * @param status - The status word as the call's arguments spelled it
 * @returns The row title
 */
function transitionTitle(number: string | null, status: string): string {
	const label = taskStatusLabel(status);
	if (number === null) {
		return i18n.t(
			'workbench:tool-call.task.transition-only',
			'Task → {{status}}',
			{
				status: label,
			},
		);
	}
	return i18n.t(
		'workbench:tool-call.task.transition',
		'Task #{{number}} → {{status}}',
		{ number, status: label },
	);
}

/**
 * Reads the id a background-task call named, which the two tools that take one
 * spell differently from the four that take a task number.
 * @param part - The tool part to read
 * @returns The reported id, or null when the call named none
 */
function backgroundTaskId(part: DynamicToolUIPart): string | null {
	return stringField(inputOf(part), 'task_id', 'taskId', 'shell_id');
}

/**
 * Files one task the agent planned. The subject titles the row and the number
 * the harness assigned is read back out of the result, since the arguments never
 * carry one; the description unfolds below rather than crowding the title.
 * @param part - The `TaskCreate` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentTaskCreate(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const subject = stringField(input, 'subject', 'title');
	const description = stringField(input, 'description');
	const number = createdTaskNumber(outputOf(part)?.text ?? '');
	return {
		badge: null,
		body:
			description === null
				? { kind: 'empty' }
				: { kind: 'markdown', text: description },
		preview: description === null ? null : { font: 'sans', text: description },
		title: taskTitle(number, subject),
		tone: 'default',
	};
}

/**
 * Reads the line an update row shows before it is opened.
 *
 * A rename or a re-description previews the new text, and a status change needs
 * no preview at all because the title already carries the transition. What is
 * left is an update that claimed an owner or wired a dependency: its arguments
 * hold nothing worth painting, so the row falls back to the sentence the harness
 * answered with, which names the fields that moved.
 * @param part - The `TaskUpdate` tool part to read
 * @returns The preview descriptor, or null when the row needs none
 */
function updatePreview(part: DynamicToolUIPart): ToolPreviewDescriptor | null {
	const input = inputOf(part);
	const rewritten = stringField(input, 'subject', 'description');
	if (rewritten !== null) {
		return { font: 'sans', text: rewritten };
	}
	if (stringField(input, 'status') !== null) {
		return null;
	}
	const reported = outputOf(part)?.text.trim() ?? '';
	return reported.length > 0 ? { font: 'sans', text: reported } : null;
}

/**
 * Moves a task along. The row says which task changed and what it became — the
 * transition is the news, and the payload that carried it is not.
 * @param part - The `TaskUpdate` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentTaskUpdate(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const number = stringField(input, 'taskId', 'task_id');
	const status = stringField(input, 'status');
	const description = stringField(input, 'description');
	return {
		badge: null,
		body:
			description === null
				? { kind: 'empty' }
				: { kind: 'markdown', text: description },
		preview: updatePreview(part),
		title:
			status === null
				? taskTitle(number, stringField(input, 'subject'))
				: transitionTitle(number, status),
		tone: 'default',
	};
}

/**
 * Shows the whole task list as a checklist, so a plan reads at a glance instead
 * of as the numbered prose the harness answers with.
 * @param part - The `TaskList` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentTaskList(part: DynamicToolUIPart): ToolPresenterResult {
	const items = parseTaskListItems(outputOf(part)?.text ?? '');
	if (items.length === 0) {
		return {
			badge: null,
			body: { kind: 'empty' },
			preview: {
				font: 'sans',
				text: i18n.t('workbench:tool-call.task.list-empty', 'No tasks'),
			},
			title: i18n.t('workbench:tool-call.task.list-title', 'Task list'),
			tone: 'default',
		};
	}
	return {
		badge: null,
		body: { items, kind: 'checklist' },
		preview: {
			font: 'sans',
			text: items.map((item) => item.subject).join(SUBJECT_SEPARATOR),
		},
		title: i18n.t('workbench:tool-call.task.list', {
			count: items.length,
			defaultValue_one: '{{count}} task',
			defaultValue_other: '{{count}} tasks',
		}),
		tone: 'default',
	};
}

/**
 * Reads one task back. The subject titles the row, its state stays pinned as the
 * preview, and the description is what unfolds.
 * @param part - The `TaskGet` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentTaskGet(part: DynamicToolUIPart): ToolPresenterResult {
	const text = outputOf(part)?.text ?? '';
	const detail = parseTaskDetail(text);
	if (detail === null) {
		return {
			badge: null,
			body: text.length === 0 ? { kind: 'empty' } : { kind: 'markdown', text },
			preview: null,
			title: taskTitle(stringField(inputOf(part), 'taskId', 'task_id'), null),
			tone: 'default',
		};
	}
	return {
		badge: null,
		body:
			detail.description === null
				? { kind: 'empty' }
				: { kind: 'markdown', text: detail.description },
		preview: { font: 'sans', text: taskStatusLabel(detail.status) },
		title: taskTitle(detail.number, detail.subject),
		tone: 'default',
	};
}

/**
 * Reads a background task's output. The payload is a shell transcript, so it
 * renders in the terminal body that can paint the colour it arrives with.
 * @param part - The `TaskOutput` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentTaskOutput(part: DynamicToolUIPart): ToolPresenterResult {
	const id = backgroundTaskId(part);
	const text = outputOf(part)?.text ?? '';
	return {
		badge: null,
		body: text.length === 0 ? { kind: 'empty' } : { kind: 'terminal', text },
		preview: null,
		title:
			id === null
				? i18n.t('workbench:tool-call.task.output-title', 'Task output')
				: i18n.t('workbench:tool-call.task.output', 'Task output: {{id}}', {
						id,
					}),
		tone: 'default',
	};
}

/**
 * Stops a background task. Whether the stop took is the whole result, so it
 * stays on the collapsed row rather than behind a disclosure.
 * @param part - The `TaskStop` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentTaskStop(part: DynamicToolUIPart): ToolPresenterResult {
	const id = backgroundTaskId(part);
	const reported = outputOf(part)?.text.trim() ?? '';
	return {
		badge: null,
		body: { kind: 'empty' },
		preview: reported.length === 0 ? null : { font: 'sans', text: reported },
		title:
			id === null
				? i18n.t('workbench:tool-call.task.stop-title', 'Stopped task')
				: i18n.t('workbench:tool-call.task.stopped', 'Stopped task {{id}}', {
						id,
					}),
		tone: 'default',
	};
}

/** The presenter each task verb answers to, keyed as `PRESENTERS` keys are. */
export const TASK_TOOL_PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ToolPresenterResult
> = {
	taskcreate: presentTaskCreate,
	taskget: presentTaskGet,
	tasklist: presentTaskList,
	taskoutput: presentTaskOutput,
	taskstop: presentTaskStop,
	taskupdate: presentTaskUpdate,
};

/**
 * Reads one created task as a checklist item. A create call always leaves its
 * task pending — the harness assigns no other state on creation — so the item's
 * state is known without reading the result.
 * @param part - The `TaskCreate` tool part to read
 * @returns The item the folded card lists for it
 */
function plannedTask(part: DynamicToolUIPart): ToolChecklistItem {
	const input = inputOf(part);
	return {
		detail: stringField(input, 'description'),
		id: part.toolCallId,
		number: createdTaskNumber(outputOf(part)?.text ?? ''),
		status: 'pending',
		subject:
			stringField(input, 'subject', 'title') ??
			i18n.t('workbench:tool-call.task.untitled', 'Untitled task'),
	};
}

/**
 * Projects a contiguous run of `TaskCreate` calls as the one plan it is.
 *
 * Seven creates in a row are a single act of planning, and seven rows saying so
 * one at a time bury the plan they add up to. The card carries the same
 * checklist a task list renders, so the plan the agent laid out and the plan it
 * later reads back look like the same object.
 * @param parts - The run's calls, in the order the turn made them
 * @returns The card's icon, title, badge, preview, and body
 */
export function presentTaskPlan(
	parts: readonly DynamicToolUIPart[],
): ToolPresentation {
	const items = parts.map(plannedTask);
	return {
		badge: null,
		body: { items, kind: 'checklist' },
		glyph: 'clipboard-list',
		preview: {
			font: 'sans',
			text: items.map((item) => item.subject).join(SUBJECT_SEPARATOR),
		},
		title: i18n.t('workbench:tool-call.task.planned', {
			count: items.length,
			defaultValue_one: 'Planned {{count}} task',
			defaultValue_other: 'Planned {{count}} tasks',
		}),
		tone: 'default',
	};
}
