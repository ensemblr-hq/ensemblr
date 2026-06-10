import type { DynamicToolUIPart } from 'ai';

/**
 * Compact one-line projection of a tool call for the activity-row renderer.
 * Mirrors the GIF reference: `[label]  [detail]  [optional chip]`.
 *
 * Unknown tools fall through to a generic projection — the tool name as label,
 * the first scalar input value as detail. Keeps the surface uniform.
 */
export interface ToolRowProjection {
	chipLabel: string | null;
	detail: string;
	label: string;
}

interface ToolInputBag {
	[key: string]: unknown;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inputOf(part: DynamicToolUIPart): ToolInputBag {
	return part.input && typeof part.input === 'object'
		? (part.input as ToolInputBag)
		: {};
}

function basename(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function projectRead(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const path = asString(input.path) ?? asString(input.file_path) ?? '';
	const limit = asNumber(input.limit) ?? asNumber(input.lines) ?? null;
	const detail = limit !== null ? `${limit} lines` : 'file';
	return {
		chipLabel: path ? basename(path) : null,
		detail,
		label: 'Read',
	};
}

function projectBash(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const command = asString(input.command) ?? asString(input.cmd) ?? '';
	return {
		chipLabel: null,
		detail: command || '(no command)',
		label: 'Bash',
	};
}

function projectGrep(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const pattern = asString(input.pattern) ?? asString(input.query) ?? '';
	const path = asString(input.path) ?? asString(input.glob) ?? '';
	return {
		chipLabel: path ? basename(path) : null,
		detail: pattern || '(empty)',
		label: 'Grep',
	};
}

function projectGlob(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const pattern = asString(input.pattern) ?? '';
	return {
		chipLabel: null,
		detail: pattern || '(empty)',
		label: 'Glob',
	};
}

function projectWrite(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const path = asString(input.path) ?? asString(input.file_path) ?? '';
	return {
		chipLabel: path ? basename(path) : null,
		detail: path || '(no path)',
		label: 'Write',
	};
}

function projectEdit(part: DynamicToolUIPart): ToolRowProjection {
	const input = inputOf(part);
	const path = asString(input.path) ?? asString(input.file_path) ?? '';
	return {
		chipLabel: path ? basename(path) : null,
		detail: path || '(no path)',
		label: 'Edit',
	};
}

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
		detail,
		label,
	};
}

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

export function projectToolRow(part: DynamicToolUIPart): ToolRowProjection {
	const projector = PROJECTORS[part.toolName.toLowerCase()];
	return projector ? projector(part) : projectGeneric(part);
}
