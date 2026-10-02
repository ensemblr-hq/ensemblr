import type { DynamicToolUIPart } from 'ai';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import {
	inputOf,
	numberField,
	outputOf,
	pathOf,
	stringField,
} from './tool-part-fields';
import { fileBadge, structuredToolOutputBody } from './tool-presenter-helpers';

/**
 * Joins the meaningful fragments of an LSP operation preview.
 * @param parts - Optional fragments in display order
 * @returns Monospaced preview, or null when every fragment is absent
 */
function lspPreview(
	parts: readonly (string | null)[],
): ToolPreviewDescriptor | null {
	const visible = parts.filter((part): part is string => part !== null);
	return visible.length === 0
		? null
		: { font: 'mono', text: visible.join(' · ') };
}

/**
 * Formats a rename source and destination as one transformation.
 * @param current - Existing symbol or file path
 * @param replacement - Requested replacement
 * @returns Available value or an old-to-new transformation
 */
function renamePreview(
	current: string | null,
	replacement: string | null,
): string | null {
	if (current === null) {
		return replacement;
	}
	return replacement === null ? current : `${current} → ${replacement}`;
}

/**
 * Reads the operation-specific subject of an LSP navigation call.
 * @param input - LSP navigation arguments
 * @param operation - Requested LSP operation
 * @returns Symbol, command, query, or rename transformation
 */
function lspNavigationSubject(
	input: Record<string, unknown>,
	operation: string | null,
): string | null {
	if (operation === 'rename') {
		return renamePreview(
			stringField(input, 'symbol'),
			stringField(input, 'newName'),
		);
	}
	if (operation === 'rename_file') {
		return renamePreview(pathOf(input), stringField(input, 'newFilePath'));
	}
	return stringField(input, 'symbol', 'query', 'command', 'newName');
}

/**
 * Names whether a mutating LSP call was previewed or applied.
 * @param input - LSP navigation arguments
 * @param details - Result metadata that may carry the authoritative state
 * @param operation - Requested LSP operation
 * @returns Localized application state for mutating operations
 */
function lspApplicationState(
	input: Record<string, unknown>,
	details: Readonly<Record<string, unknown>> | null,
	operation: string | null,
): string | null {
	if (!['executeCommand', 'rename', 'rename_file'].includes(operation ?? '')) {
		return null;
	}
	const applied =
		typeof details?.applied === 'boolean'
			? details.applied
			: input.apply === true;
	return applied
		? i18n.t('workbench:tool-call.lsp-navigation.applied', 'applied')
		: i18n.t('workbench:tool-call.lsp-navigation.preview', 'preview');
}

/**
 * Presents an LSP navigation request by operation, subject, mutation state, and line.
 * @param part - The `lsp_navigation` call to project
 * @returns File scope, navigation preview, and response body
 */
export function presentLspNavigation(
	part: DynamicToolUIPart,
): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	const details = output?.details ?? null;
	const operation = stringField(input, 'operation');
	const line = numberField(input, 'line');
	const lineLabel =
		line === null
			? null
			: i18n.t('workbench:tool-call.lsp-navigation.line', 'line {{line}}', {
					line,
				});
	const text = output?.text ?? '';
	return {
		badge: fileBadge(pathOf(input)),
		body: structuredToolOutputBody(part.toolName, text),
		preview: lspPreview([
			operation,
			lspNavigationSubject(input, operation),
			lspApplicationState(input, details, operation),
			lineLabel,
		]),
		title: i18n.t('workbench:tool-call.lsp-navigation.title', 'LSP navigation'),
		tone: 'default',
	};
}
