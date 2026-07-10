import type { DynamicToolUIPart } from 'ai';

import type { ToolRowProjection } from '@/renderer/types/pi-timeline';

/** Loosely-typed bag of tool input fields keyed by name. */
interface ToolInputBag {
	[key: string]: unknown;
}

/**
 * Returns the value when it is a non-empty string, otherwise null.
 * @param value - The candidate value
 * @returns The string, or null when it is empty or not a string
 */
function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Returns the value when it is a finite number, otherwise null.
 * @param value - The candidate value
 * @returns The number, or null when it is not a finite number
 */
function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads a tool part's input as a field bag, defaulting to an empty object.
 * @param part - The dynamic-tool part to read
 * @returns The input object, or an empty bag when it is absent
 */
function inputOf(part: DynamicToolUIPart): ToolInputBag {
	return part.input && typeof part.input === 'object'
		? (part.input as ToolInputBag)
		: {};
}

/**
 * Extracts the final path segment, ignoring trailing slashes.
 * @param path - The path to reduce
 * @returns The last segment of the path
 */
function basename(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Projects a file-read tool call into a row with the file-basename chip and a
 * line-count detail.
 * @param part - The dynamic-tool part for the read call
 * @returns The activity-row projection
 */
function projectRead(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const path = asString(input.path) ?? asString(input.file_path) ?? '';
	const limit = asNumber(input.limit) ?? asNumber(input.lines) ?? null;
	const detail = limit !== null ? `${limit} lines` : 'file';
	return {
		chipLabel: path ? basename(path) : null,
		chipPath: path || null,
		detail,
		label: 'Read',
	};
}

/**
 * Projects a shell tool call into a row showing the command as the detail.
 * @param part - The dynamic-tool part for the shell call
 * @returns The activity-row projection
 */
function projectBash(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const command = asString(input.command) ?? asString(input.cmd) ?? '';
	return {
		chipLabel: null,
		chipPath: null,
		detail: command || '(no command)',
		label: 'Bash',
	};
}

/**
 * Projects a search tool call into a row with the pattern as detail and an
 * optional path chip.
 * @param part - The dynamic-tool part for the search call
 * @returns The activity-row projection
 */
function projectGrep(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const pattern = asString(input.pattern) ?? asString(input.query) ?? '';
	const path = asString(input.path) ?? asString(input.glob) ?? '';
	return {
		chipLabel: path ? basename(path) : null,
		chipPath: path || null,
		detail: pattern || '(empty)',
		label: 'Grep',
	};
}

/**
 * Projects a glob tool call into a row showing the pattern as the detail.
 * @param part - The dynamic-tool part for the glob call
 * @returns The activity-row projection
 */
function projectGlob(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const pattern = asString(input.pattern) ?? '';
	return {
		chipLabel: null,
		chipPath: null,
		detail: pattern || '(empty)',
		label: 'Glob',
	};
}

/**
 * Projects a file-write tool call into a row with the file-basename chip.
 * @param part - The dynamic-tool part for the write call
 * @returns The activity-row projection
 */
function projectWrite(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const path = asString(input.path) ?? asString(input.file_path) ?? '';
	return {
		chipLabel: path ? basename(path) : null,
		chipPath: path || null,
		detail: path || '(no path)',
		label: 'Write',
	};
}

/**
 * Projects a file-edit tool call into a row with the file-basename chip.
 * @param part - The dynamic-tool part for the edit call
 * @returns The activity-row projection
 */
function projectEdit(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const path = asString(input.path) ?? asString(input.file_path) ?? '';
	return {
		chipLabel: path ? basename(path) : null,
		chipPath: path || null,
		detail: path || '(no path)',
		label: 'Edit',
	};
}

/**
 * Fallback projection for unknown tools: the humanized tool name as the label
 * and the first scalar input value as the detail.
 * @param part - The dynamic-tool part for the call
 * @returns The activity-row projection
 */
function projectGeneric(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const firstScalar = Object.values(input).find(
		(value) => typeof value === 'string' || typeof value === 'number',
	);
	const detail =
		typeof firstScalar === 'string' || typeof firstScalar === 'number'
			? String(firstScalar)
			: '';
	const label = humanizeToolName(part.toolName);
	return {
		chipLabel: null,
		chipPath: null,
		detail,
		label,
	};
}

/**
 * Turns a raw tool name into a title-cased, space-separated label.
 * @param name - The raw tool name
 * @returns The humanized label, or `'Tool'` when the name is empty
 */
function humanizeToolName(name: string): string {
	if (!name) {
		return 'Tool';
	}
	const cleaned = name.replace(/[_-]+/g, ' ').trim();
	if (cleaned.length === 0) {
		return name;
	}
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const PROJECTORS: Record<
	string,
	(part: DynamicToolUIPart) => ToolRowProjection
> = {
	bash: projectBash,
	cli: projectBash,
	edit: projectEdit,
	glob: projectGlob,
	grep: projectGrep,
	read: projectRead,
	read_file: projectRead,
	run_command: projectBash,
	search: projectGrep,
	shell: projectBash,
	str_replace: projectEdit,
	str_replace_editor: projectEdit,
	view: projectRead,
	write: projectWrite,
	write_file: projectWrite,
};

/**
 * Projects any tool call into a compact activity row, dispatching to a
 * tool-specific projector or the generic fallback.
 * @param part - The dynamic-tool part to project
 * @returns The activity-row projection
 */
export function projectToolRow(part: DynamicToolUIPart): ToolRowProjection {
	const projector = PROJECTORS[part.toolName.toLowerCase()];
	return projector ? projector(part) : projectGeneric(part);
}
