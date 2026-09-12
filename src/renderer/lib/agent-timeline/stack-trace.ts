import type {
	ParsedStackTrace,
	StackFrame,
} from '@/renderer/types/agent-timeline';

const STACK_FRAME_WITH_PARENS = /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/;
const STACK_FRAME_WITHOUT_FN = /^at\s+(.+):(\d+):(\d+)$/;
const ERROR_TYPE_PREFIX = /^(\w*Error):\s*(.*)$/;
const FRAME_LINE_PREFIX = /^at\s+/;

/**
 * Whether a frame's file points at the runtime or an installed package rather
 * than at the app's own source.
 * @param filePath - File path the frame named, if it named one
 * @returns True when the frame comes from a dependency or a Node internal
 */
function isInternalSource(filePath: string | null): boolean {
	if (!filePath) {
		return false;
	}
	return (
		filePath.includes('node_modules') ||
		filePath.startsWith('node:') ||
		filePath.includes('internal/')
	);
}

/**
 * Parse one stack-trace line into a structured frame, keeping the raw line so an
 * unparseable one still renders.
 * @param line - A single stack-trace line
 * @returns The parsed frame; location fields are null when the line does not match a known shape
 */
function parseStackFrame(line: string): StackFrame {
	const raw = line.trim();

	const withFunction = raw.match(STACK_FRAME_WITH_PARENS);
	if (withFunction) {
		const [, functionName, filePath, lineNumber, columnNumber] = withFunction;
		return {
			columnNumber: Number.parseInt(columnNumber, 10),
			filePath,
			functionName,
			isInternal: isInternalSource(filePath),
			lineNumber: Number.parseInt(lineNumber, 10),
			raw,
		};
	}

	const withoutFunction = raw.match(STACK_FRAME_WITHOUT_FN);
	if (withoutFunction) {
		const [, filePath, lineNumber, columnNumber] = withoutFunction;
		return {
			columnNumber: Number.parseInt(columnNumber, 10),
			filePath,
			functionName: null,
			isInternal: isInternalSource(filePath),
			lineNumber: Number.parseInt(lineNumber, 10),
			raw,
		};
	}

	return {
		columnNumber: null,
		filePath: null,
		functionName: null,
		isInternal: raw.includes('node_modules') || raw.includes('node:'),
		lineNumber: null,
		raw,
	};
}

/**
 * Split raw traceback text into the error line and the frames beneath it.
 *
 * A payload that carries no recognisable frames still parses: the whole text
 * becomes the message, so a caller can render it without checking first.
 * @param trace - Raw traceback text as the runtime printed it
 * @returns The error type and message plus every parsed frame
 */
export function parseStackTrace(trace: string): ParsedStackTrace {
	const lines = trace.split('\n').filter((line) => line.trim());

	if (lines.length === 0) {
		return { errorMessage: trace, errorType: null, frames: [] };
	}

	const headline = lines[0].trim();
	const typed = headline.match(ERROR_TYPE_PREFIX);

	const frames = lines
		.slice(1)
		.flatMap((line) =>
			FRAME_LINE_PREFIX.test(line.trim()) ? [parseStackFrame(line)] : [],
		);

	return {
		errorMessage: typed ? typed[2] : headline,
		errorType: typed ? typed[1] : null,
		frames,
	};
}
