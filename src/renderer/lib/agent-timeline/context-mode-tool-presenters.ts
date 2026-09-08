import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolGlyph,
	ToolPresenterResult,
} from '@/renderer/types/tool-presentation';
import { inputOf, outputOf, pathOf, stringField } from './tool-part-fields';
import { fileBadge } from './tool-presenter-helpers';

/** Icon assignments for context-mode execution tools. */
export const CONTEXT_MODE_TOOL_GLYPHS = {
	ctx_execute: 'square-terminal',
	ctx_execute_file: 'square-terminal',
} satisfies Record<string, ToolGlyph>;

/**
 * Removes context-mode's fenced echo of the submitted program from a result.
 * @param text - Full execution result text
 * @returns The subprocess output without the duplicated program
 */
function stripContextExecutionEcho(text: string): string {
	const pathPrefixEnd = text.startsWith('path=') ? text.indexOf('\n') : -1;
	const fencedStart = pathPrefixEnd < 0 ? 0 : pathPrefixEnd + 1;
	if (!text.startsWith('```', fencedStart)) {
		return text;
	}
	const openingEnd = text.indexOf('\n', fencedStart);
	const closingStart = text.indexOf('\n```\n\n', openingEnd + 1);
	if (openingEnd < 0 || closingStart < 0) {
		return text;
	}
	return text.slice(closingStart + '\n```\n\n'.length);
}

/**
 * Names the context-mode execution variant in the active locale.
 * @param toolName - Runtime name of the execution tool
 * @returns The title for a sandbox execution or file-processing call
 */
function contextExecutionTitle(toolName: string): string {
	if (toolName.toLowerCase() === 'ctx_execute_file') {
		return i18n.t('workbench:tool-call.ctx-execute-file.title', 'Process file');
	}
	return i18n.t('workbench:tool-call.ctx-execute.title', 'Run code');
}

/**
 * Presents context-mode execution as separate source and output blocks.
 * @param part - A `ctx_execute` or `ctx_execute_file` tool part to project
 * @returns The row's title, target, intent preview, source, and subprocess output
 */
function presentContextExecution(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const code = stringField(input, 'code') ?? '';
	const intent = stringField(input, 'intent');
	const compactCode = code.replace(/\s+/g, ' ').trim();
	const previewText = intent ?? compactCode;
	const isFileExecution = part.toolName.toLowerCase() === 'ctx_execute_file';
	return {
		badge: isFileExecution ? fileBadge(pathOf(input)) : null,
		body: {
			kind: 'labeled',
			sections: [
				{
					label: i18n.t('workbench:tool-call.ctx-execute.code-label', 'Code:'),
					muted: true,
					text: code,
				},
				{
					label: i18n.t('workbench:tool-call.generic.output-label', 'Output:'),
					muted: false,
					text: stripContextExecutionEcho(outputOf(part)?.text ?? ''),
				},
			],
		},
		preview:
			previewText.length === 0
				? null
				: { font: intent === null ? 'mono' : 'sans', text: previewText },
		title: contextExecutionTitle(part.toolName),
		tone: 'default',
	};
}

/** Dedicated presenters for context-mode execution tools. */
export const CONTEXT_MODE_TOOL_PRESENTERS = {
	ctx_execute: presentContextExecution,
	ctx_execute_file: presentContextExecution,
} satisfies Record<string, (part: DynamicToolUIPart) => ToolPresenterResult>;
