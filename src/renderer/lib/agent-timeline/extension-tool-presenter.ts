import type { DynamicToolUIPart } from 'ai';
import { toBundledLanguage } from '@/renderer/lib/language-from-path';
import type {
	ToolBodyDescriptor,
	ToolPresenterResult,
} from '@/renderer/types/tool-presentation';
import {
	parseToolPresentation,
	resolveToolPresentationText,
	type ToolPresentationBody,
	type ToolPresentationV1,
} from '@/shared/tool-presentation';
import { canonicalEnsemblrToolName } from './ensemblr-control-tool-registry';
import { inputOf, outputOf } from './tool-part-fields';

/** Core runtime tools whose presentation must remain host-owned. */
const PROTECTED_CORE_TOOL_NAMES = new Set([
	'agent',
	'bash',
	'cli',
	'edit',
	'find',
	'glob',
	'grep',
	'list_directory',
	'ls',
	'powershell',
	'read',
	'read_file',
	'run_command',
	'search',
	'shell',
	'skill',
	'str_replace',
	'str_replace_editor',
	'task',
	'view',
	'write',
	'write_file',
]);

/** A dynamic tool part carrying the validated extension snapshot, if any. */
type PresentedToolPart = DynamicToolUIPart & {
	toolPresentation?: unknown;
};

/**
 * Reads the validated extension snapshot attached by the timeline mapper.
 * @param part - Tool part carrying untrusted persisted metadata
 * @returns The safe descriptor, or null when absent or invalid
 */
export function extensionPresentationOf(
	part: DynamicToolUIPart,
): ToolPresentationV1 | null {
	const candidate = (part as PresentedToolPart).toolPresentation;
	return candidate === undefined ? null : parseToolPresentation(candidate);
}

/**
 * Checks whether the host must retain control of a tool's presentation.
 * @param toolName - Runtime-reported tool name
 * @returns True for core runtime and Ensemblr Control tools
 */
export function isProtectedToolName(toolName: string): boolean {
	return (
		canonicalEnsemblrToolName(toolName) !== null ||
		PROTECTED_CORE_TOOL_NAMES.has(toolName.toLowerCase())
	);
}

/**
 * Checks whether a host permission decision owns the current row.
 * @param part - Tool part to classify
 * @returns True while approval is pending or denied
 */
export function isHostPermissionState(part: DynamicToolUIPart): boolean {
	return (
		part.state === 'approval-requested' ||
		(part.state === 'approval-responded' &&
			'approval' in part &&
			part.approval.approved === false)
	);
}

/**
 * Projects an extension-owned descriptor through native Ensemblr body types.
 * @param part - Tool call carrying the extension snapshot
 * @param descriptor - Validated extension descriptor
 * @param fallback - Existing host presentation used for omitted body fields
 * @param language - Current app language
 * @returns Native presentation data, or null when the tool is host-owned
 */
export function presentExtensionToolCall(
	part: DynamicToolUIPart,
	descriptor: ToolPresentationV1,
	fallback: ToolPresenterResult,
	language: string,
): ToolPresenterResult | null {
	if (isProtectedToolName(part.toolName)) {
		return null;
	}
	return {
		badge: fallback.badge,
		body: descriptor.body
			? extensionBody(descriptor.body, fallback.body, language)
			: fallback.body,
		extensionOwned: true,
		glyph: descriptor.glyph,
		rawIO: {
			input: formatInput(inputOf(part)),
			output: outputOf(part)?.text ?? '',
			toolName: part.toolName,
		},
		preview: descriptor.preview
			? {
					font: descriptor.preview.font,
					text: resolveToolPresentationText(descriptor.preview.text, language),
				}
			: fallback.preview,
		title: resolveToolPresentationText(descriptor.title, language),
		tone: fallback.tone,
	};
}

/**
 * Maps one portable body primitive to the renderer's existing body descriptor.
 * @param body - Validated extension body
 * @param fallback - Host body used only when no primitive is available
 * @param language - Current app language for display prose
 * @returns Native body descriptor
 */
function extensionBody(
	body: ToolPresentationBody,
	fallback: ToolBodyDescriptor,
	language: string,
): ToolBodyDescriptor {
	switch (body.kind) {
		case 'markdown':
			return {
				kind: 'markdown',
				text: resolveToolPresentationText(body.text, language),
			};
		case 'code':
			return {
				code: body.code,
				kind: 'code',
				language: toBundledLanguage(body.language),
				startLine: body.startLine ?? null,
			};
		case 'labeled':
			return {
				kind: 'labeled',
				sections: body.sections.map((section) => ({
					label: resolveToolPresentationText(section.label, language),
					muted: section.muted ?? false,
					text: resolveToolPresentationText(section.text, language),
				})),
			};
		case 'terminal':
			return { kind: 'terminal', text: body.text };
		case 'diff':
			return {
				kind: 'diff',
				language: toBundledLanguage(body.language),
				patch: body.patch,
				showFileNames: body.showFileNames,
			};
		case 'diagnostics':
			return {
				entries: body.entries.map((entry) => ({
					column: entry.column ?? null,
					line: entry.line ?? null,
					message: resolveToolPresentationText(entry.message, language),
					severity: entry.severity,
					source: entry.source ?? null,
				})),
				kind: 'diagnostics',
			};
		case 'checklist':
			return {
				items: body.items.map((item) => ({
					detail:
						item.detail === undefined
							? null
							: resolveToolPresentationText(item.detail, language),
					id: item.id,
					number: item.number ?? null,
					status: item.status,
					subject: resolveToolPresentationText(item.subject, language),
				})),
				kind: 'checklist',
			};
		default: {
			const exhaustive: never = body;
			void exhaustive;
			return fallback;
		}
	}
}

/**
 * Serializes tool input for the host-owned raw execution disclosure.
 * @param input - The input bag sent to the tool
 * @returns Deterministic JSON or a safe fallback string
 */
function formatInput(input: unknown): string {
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}
