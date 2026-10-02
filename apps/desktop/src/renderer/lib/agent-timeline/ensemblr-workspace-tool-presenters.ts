import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import {
	bold,
	type ControlRow,
	codeSpan,
	controlAck,
	controlPayloadRecord,
	controlPayloadRows,
	isRecord,
	joinFacts,
	listRow,
	stringValue,
} from './ensemblr-control-presenter-helpers';
import { classifiedToolOutputBody } from './tool-presenter-helpers';

/**
 * How the workspace and terminal control ops read once a row is opened.
 *
 * All three are readings of live app state rather than actions on it, so the
 * payload *is* the answer: which workspaces exist, which terminals are free to
 * reuse, what a terminal has printed. The generic shape rendered each as a
 * single unwrapped line of JSON, which is the form in which none of them can be
 * read at all.
 *
 * Titles, glyphs, and chips stay with `ensemblr-control-tool-registry.ts`.
 */

/** Lines of scrollback a terminal body keeps, counted from the end. */
const TERMINAL_TAIL_LINES = 200;

/**
 * Localizes a workspace's kanban column, reusing the board's own labels so a
 * row and the board never disagree about what a status is called.
 * @param status - The board status as the payload reported it
 * @returns The localized label, or the raw value when it is not a known column
 */
function boardStatusLabel(status: string | null): string | null {
	switch (status) {
		case 'backlog':
			return i18n.t('workbench:board-status.backlog', 'Backlog');
		case 'canceled':
			return i18n.t('workbench:board-status.canceled', 'Canceled');
		case 'done':
			return i18n.t('workbench:board-status.done', 'Done');
		case 'in-progress':
			return i18n.t('workbench:board-status.in-progress', 'In progress');
		case 'in-review':
			return i18n.t('workbench:board-status.in-review', 'In review');
		default:
			return status;
	}
}

/**
 * Presents the workspace listing. Board status rides each row because the
 * listing is most often read to decide which workspace to act on next.
 * @param part - The `ensemblr_list_workspaces` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentListWorkspaces(part: DynamicToolUIPart): ControlRow {
	const rows = controlPayloadRows(part, 'workspaces');
	if (rows === null) {
		return controlAck();
	}
	const rendered = rows.flatMap((workspace) => {
		if (!isRecord(workspace)) {
			return [];
		}
		const name = stringValue(workspace, 'name');
		if (name === null) {
			return [];
		}
		const cwd = stringValue(workspace, 'cwd');
		return [
			joinFacts([
				bold(name),
				stringValue(workspace, 'projectName'),
				boardStatusLabel(stringValue(workspace, 'boardStatus')),
				cwd === null ? null : codeSpan(cwd),
			]),
		];
	});
	return listRow(
		rendered,
		i18n.t('workbench:control-tool.preview.workspaces', {
			count: rendered.length,
			defaultValue_one: '{{count}} workspace',
			defaultValue_other: '{{count}} workspaces',
		}),
	);
}

/**
 * Presents the terminal listing. The foreground command is the field that
 * decides the call the listing is made for — a running terminal reports one and
 * an idle shell reports none, which is what makes an idle terminal identifiable
 * as one worth reusing.
 * @param part - The `ensemblr_list_terminals` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentListTerminals(part: DynamicToolUIPart): ControlRow {
	const rows = controlPayloadRows(part, 'terminals');
	if (rows === null) {
		return controlAck();
	}
	const rendered = rows.flatMap((terminal) => {
		if (!isRecord(terminal)) {
			return [];
		}
		const terminalId = stringValue(terminal, 'terminalId');
		if (terminalId === null) {
			return [];
		}
		const command = stringValue(terminal, 'foregroundCommand');
		const shell = stringValue(terminal, 'shell');
		return [
			joinFacts([
				bold(stringValue(terminal, 'kind') ?? terminalId),
				stringValue(terminal, 'status'),
				stringValue(terminal, 'scriptName'),
				command === null
					? i18n.t('workbench:control-tool.terminal.idle', 'idle')
					: codeSpan(command),
				shell === null ? null : codeSpan(shell),
			]),
		];
	});
	return listRow(
		rendered,
		i18n.t('workbench:control-tool.preview.terminals', {
			count: rendered.length,
			defaultValue_one: '{{count}} terminal',
			defaultValue_other: '{{count}} terminals',
		}),
	);
}

/**
 * Keeps the end of a terminal's scrollback, which is the part a read is made
 * for. An unbounded buffer is what a row cannot carry and what nobody scrolls
 * a disclosure to the bottom of.
 * @param output - The scrollback as the terminal reported it
 * @returns The last lines, and how many were dropped
 */
function tailOutput(output: string): { dropped: number; text: string } {
	const lines = output.split('\n');
	if (lines.length <= TERMINAL_TAIL_LINES) {
		return { dropped: 0, text: output };
	}
	return {
		dropped: lines.length - TERMINAL_TAIL_LINES,
		text: lines.slice(-TERMINAL_TAIL_LINES).join('\n'),
	};
}

/**
 * Presents a terminal's scrollback through the same bodies every other command
 * output uses, so ANSI colour still renders as a terminal and plain output
 * still highlights.
 * @param part - The `ensemblr_read_terminal_output` tool part to project
 * @returns The row's body and collapsed summary
 */
function presentReadTerminalOutput(part: DynamicToolUIPart): ControlRow {
	const payload = controlPayloadRecord(part);
	const output = payload === null ? null : stringValue(payload, 'output');
	if (output === null) {
		return controlAck();
	}
	const { dropped, text } = tailOutput(output);
	return {
		body: classifiedToolOutputBody(part.toolName, text),
		preview:
			dropped === 0
				? null
				: {
						font: 'sans',
						text: i18n.t('workbench:control-tool.terminal.tail', {
							count: dropped,
							defaultValue_one:
								'last {{lines}} lines · {{count}} earlier hidden',
							defaultValue_other:
								'last {{lines}} lines · {{count}} earlier hidden',
							lines: TERMINAL_TAIL_LINES,
						}),
					},
	};
}

/** Workspace and terminal control ops, keyed by their canonical tool name. */
export const ENSEMBLR_WORKSPACE_TOOL_PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ControlRow
> = {
	ensemblr_list_terminals: presentListTerminals,
	ensemblr_list_workspaces: presentListWorkspaces,
	ensemblr_read_terminal_output: presentReadTerminalOutput,
};
