/**
 * One-line human summaries for tool-call cards, derived from the tool names
 * and arg shapes observed in the fixture matrix (`read`, `bash`, `edit`,
 * `lsp_diagnostics` — see docs/pi/event-taxonomy.md).
 */

import type { PiToolCallItem } from '@/renderer/types/pi-timeline';

const SUMMARY_MAX_LENGTH = 64;

/** Shortens an absolute path to its last two segments. */
function shortPath(value: string): string {
	const segments = value.split('/').filter(Boolean);
	return segments.slice(-2).join('/') || value;
}

function firstLine(value: string): string {
	const line = value.split('\n', 1)[0] ?? '';
	return line.length > SUMMARY_MAX_LENGTH
		? `${line.slice(0, SUMMARY_MAX_LENGTH)}…`
		: line;
}

function stringArg(
	args: Readonly<Record<string, unknown>>,
	...keys: string[]
): string | null {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return null;
}

/** Counts added/removed lines in a unified diff body. */
export function diffStats(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			added += 1;
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			removed += 1;
		}
	}
	return { added, removed };
}

/**
 * Builds the collapsed one-line summary for a tool call, e.g.
 * `read src/index.ts`, `bash seq 1 500`, `edit src/broken.ts +2 −1`.
 */
export function summarizeToolCall(call: PiToolCallItem): string {
	const path = stringArg(call.args, 'path', 'file_path', 'filePath', 'file');
	switch (call.toolName) {
		case 'bash': {
			const command = stringArg(call.args, 'command');
			return command ? firstLine(command) : 'shell command';
		}
		case 'read':
			return path ? shortPath(path) : 'file';
		case 'edit':
		case 'write': {
			const label = path ? shortPath(path) : 'file';
			const diff =
				call.details && typeof call.details.diff === 'string'
					? call.details.diff
					: null;
			if (!diff) {
				return label;
			}
			const { added, removed } = diffStats(diff);
			return `${label} +${added} −${removed}`;
		}
		default: {
			if (path) {
				return shortPath(path);
			}
			const firstString = Object.values(call.args).find(
				(value): value is string => typeof value === 'string',
			);
			return firstString ? firstLine(firstString) : '';
		}
	}
}
