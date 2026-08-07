import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { buildToolDiffRows } from '@/renderer/lib/diff/tool-rows';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import type {
	AgentToolOutput,
	PiCustomMessageData,
} from '@/renderer/types/agent-timeline';
import type {
	ToolBadgeDescriptor,
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresentation,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import {
	ensemblrControlFailure,
	ensemblrToolGlyph,
	ensemblrToolLabel,
} from './ensemblr-tool-presentation';
import { parseNumberedFileBody } from './numbered-file-body';
import { shellCommandTitle } from './shell-command-title';
import { parseToolDiagnostics } from './tool-diagnostics';
import {
	classifyToolOutput,
	looksLikeStackTrace,
} from './tool-output-classifier';

/** Matches an ANSI colour escape, which only the terminal body can render. */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`);

/**
 * Matches the `read` tool's placeholder text for an image target ("Read image
 * file [image/png]") — the whole result, not file content to number as code.
 */
const IMAGE_READ_PLACEHOLDER = /^Read image file \[[^[\]]+\]$/;

/** Tool states that still represent work in flight rather than a result. */
const RUNNING_STATES = new Set(['input-streaming', 'input-available']);

/**
 * Icon each known tool answers to. Held apart from the presenters so a summary
 * strip can name a call's mark without projecting its body, which for a long
 * turn would mean re-serializing every payload on every render.
 */
const TOOL_GLYPHS: Record<string, ToolGlyph> = {
	bash: 'terminal',
	cli: 'terminal',
	edit: 'file-pen',
	glob: 'folder-tree',
	grep: 'search',
	list_directory: 'folder-tree',
	ls: 'folder-tree',
	lsp_diagnostics: 'stethoscope',
	read: 'file-text',
	read_file: 'file-text',
	run_command: 'terminal',
	search: 'search',
	shell: 'terminal',
	str_replace: 'file-pen',
	str_replace_editor: 'file-pen',
	view: 'file-text',
	write: 'file-plus',
	write_file: 'file-plus',
};

/**
 * Everything a presenter decides. The glyph normally follows from the tool's
 * name, so it stays optional here; a presenter sets it only to override that
 * default, e.g. an image `read` marking itself distinctly from a text one.
 */
type ToolPresenterResult = Omit<ToolPresentation, 'glyph'> & {
	glyph?: ToolGlyph;
};

/**
 * Narrows a value to a non-array object record.
 * @param value - The value to test
 * @returns True when `value` is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a tool part's input as a field bag.
 * @param part - The tool part to read
 * @returns The input record, or an empty bag when it is absent
 */
function inputOf(part: DynamicToolUIPart): Record<string, unknown> {
	return isRecord(part.input) ? part.input : {};
}

/**
 * Reads a tool part's normalized result.
 *
 * Tolerates the pre-envelope shape (a bare string on `output`) so timelines
 * persisted before the mapper carried `details` still render.
 * @param part - The tool part to read
 * @returns The normalized output, or null while the call is still running
 */
function outputOf(part: DynamicToolUIPart): AgentToolOutput | null {
	if (!('output' in part) || part.output === undefined) {
		return null;
	}
	const output = part.output;
	if (typeof output === 'string') {
		return { details: null, text: output };
	}
	if (!isRecord(output)) {
		return null;
	}
	return {
		details: isRecord(output.details) ? output.details : null,
		text: typeof output.text === 'string' ? output.text : '',
	};
}

/**
 * Reads the first non-empty string among the given keys.
 * @param bag - Record to read from
 * @param keys - Keys to try, in order
 * @returns The first non-empty string, or null when none match
 */
function stringField(
	bag: Record<string, unknown>,
	...keys: string[]
): string | null {
	for (const key of keys) {
		const value = bag[key];
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}
	return null;
}

/**
 * Reads the first finite number among the given keys.
 * @param bag - Record to read from
 * @param keys - Keys to try, in order
 * @returns The first finite number, or null when none match
 */
function numberField(
	bag: Record<string, unknown>,
	...keys: string[]
): number | null {
	for (const key of keys) {
		const value = bag[key];
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}
	return null;
}

/**
 * Reads whichever key a tool uses for the path it operates on.
 * @param bag - Tool input or details record to read from
 * @returns The reported path, or null when the tool named none
 */
function pathOf(bag: Record<string, unknown>): string | null {
	return stringField(bag, 'path', 'file_path', 'filePath', 'file');
}

/**
 * Builds the chip that pins a tool's target path to its row.
 * @param path - Path the tool operated on, or null when it named none
 * @param kind - Whether the path is a file or a directory
 * @param counts - Added and removed line counts; either side may be null when
 * the tool reports only one, as a fresh write does
 * @returns The badge, or null when there is no path to pin
 */
function fileBadge(
	path: string | null,
	kind: 'file' | 'folder' = 'file',
	counts: { additions: number | null; deletions: number | null } | null = null,
): ToolBadgeDescriptor | null {
	if (path === null) {
		return null;
	}
	return {
		additions: counts?.additions ?? null,
		deletions: counts?.deletions ?? null,
		kind,
		path,
	};
}

/**
 * Resolves the Shiki grammar for a path, falling back to plain text.
 * @param path - Path whose extension picks the grammar, or null when unknown
 * @returns The Shiki language to highlight with
 */
function languageFor(path: string | null): BundledLanguage {
	return path ? languageForFilePath(path) : ('text' as BundledLanguage);
}

/**
 * Preview standing in for a missing file chip, so a path-shaped row still says
 * something when the tool call arrived without one.
 * @param path - The path the tool named, or null when it named none
 * @returns The placeholder preview, or null when the badge will carry the path
 */
function missingPathPreview(path: string | null): ToolPreviewDescriptor | null {
	return path === null ? { font: 'mono', text: '(no path)' } : null;
}

/**
 * Counts a unified patch's added and removed lines from its parsed hunks, which
 * is the same projection the diff body renders — so the badge can never disagree
 * with the rows below it, and content lines opening with `--`, `++`, or a `---`
 * frontmatter fence are never mistaken for file headers.
 * @param patch - Unified diff for a single file
 * @returns The added and removed line counts
 */
function countPatchLines(patch: string): {
	additions: number;
	deletions: number;
} {
	const { rows } = buildToolDiffRows(patch);
	return {
		additions: rows.filter((row) => row.kind === 'insert').length,
		deletions: rows.filter((row) => row.kind === 'delete').length,
	};
}

/**
 * Counts the lines a payload occupies, treating an empty payload as zero and a
 * trailing newline as the terminator it is rather than as another line.
 * @param text - The payload to measure
 * @returns The number of lines the payload holds
 */
function lineCount(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	const lines = text.split('\n');
	return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

/**
 * Picks the body for free-form command or search output: the terminal only when
 * the payload actually carries ANSI colour, otherwise the shared code surface
 * so most rows keep the same chrome.
 * @param text - The tool's output text
 * @param language - Shiki grammar for the non-ANSI case
 * @returns The matching body descriptor
 */
function textBody(text: string, language: BundledLanguage): ToolBodyDescriptor {
	if (ANSI_ESCAPE.test(text)) {
		return { kind: 'terminal', text };
	}
	return { code: text, kind: 'code', language, startLine: null };
}

/**
 * Renders a tool input bag as pretty JSON for a labelled body.
 * @param input - The tool call's input record
 * @returns The formatted JSON, or the coerced string when it cannot serialize
 */
function formatInput(input: Record<string, unknown>): string {
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}

/**
 * Turns a raw tool name into a title-cased, space-separated label.
 * @param name - The raw tool name
 * @returns The humanized label, or `'Tool'` when the name is empty
 */
function humanizeToolName(name: string): string {
	const cleaned = name.replace(/[_-]+/g, ' ').trim();
	if (cleaned.length === 0) {
		return 'Tool';
	}
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Reads a file and shows it with a gutter numbered from the tool's own numbering
 * when it returned a numbered body — both the truer origin and the only way the
 * row avoids two gutters — and from the requested start line otherwise.
 * @param part - The `read` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentRead(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const path = pathOf(input);
	const output = outputOf(part);
	const text = output?.text ?? '';
	// The read tool never returns a numbered file body for an image — only this
	// one-line placeholder — so a line-numbered code body and a "Read N lines"
	// title would both be fiction. Fall back to the plain file badge instead.
	if (IMAGE_READ_PLACEHOLDER.test(text.trim())) {
		return {
			badge: fileBadge(path),
			body: { kind: 'empty' },
			glyph: 'image',
			preview: missingPathPreview(path),
			title: 'Read image',
			tone: 'default',
		};
	}
	const requestedLine = numberField(
		input,
		'offset',
		'start_line',
		'startLine',
		'line',
	);
	const numbered = parseNumberedFileBody(text);
	const code = numbered?.code ?? text;
	const lines = lineCount(code);
	return {
		badge: fileBadge(path),
		body: {
			code,
			kind: 'code',
			language: languageFor(path),
			startLine: numbered?.startLine ?? requestedLine ?? 1,
		},
		preview: missingPathPreview(path),
		title: lines > 0 ? `Read ${lines} lines` : 'Read',
		tone: 'default',
	};
}

/**
 * Pairs the badge counts and body a unified patch renders as, so the two can
 * never disagree about which change the row is describing.
 * @param part - The file-writing tool part to project
 * @returns The badge and body, or null when the result carried no patch
 */
function patchPresentation(
	part: DynamicToolUIPart,
): Pick<ToolPresenterResult, 'badge' | 'body'> | null {
	const path = pathOf(inputOf(part));
	const patch = stringField(outputOf(part)?.details ?? {}, 'patch');
	if (patch === null) {
		return null;
	}
	return {
		badge: fileBadge(path, 'file', countPatchLines(patch)),
		body: { kind: 'diff', language: languageFor(path), patch },
	};
}

/**
 * Creates or overwrites a file. An overwrite reports the patch it applied, so
 * the row shows what changed rather than a whole file the reader has to diff by
 * eye; a fresh file has no before side, and shows the content that was written.
 * @param part - The `write` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentWrite(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const path = pathOf(input);
	const content = stringField(input, 'content', 'text', 'contents') ?? '';
	const written =
		content.length > 0
			? { additions: lineCount(content), deletions: null }
			: null;
	const applied = patchPresentation(part);
	return {
		badge: applied?.badge ?? fileBadge(path, 'file', written),
		body: applied?.body ?? {
			code: content,
			kind: 'code',
			language: languageFor(path),
			startLine: 1,
		},
		preview: missingPathPreview(path),
		title: 'Write',
		tone: 'default',
	};
}

/**
 * Edits a file. The unified patch travels in `details.patch`, so the row can
 * show a real diff instead of the prose confirmation Pi puts in the text.
 * @param part - The `edit` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentEdit(part: DynamicToolUIPart): ToolPresenterResult {
	const path = pathOf(inputOf(part));
	const output = outputOf(part);
	const applied = patchPresentation(part);
	return {
		badge: applied?.badge ?? fileBadge(path),
		body:
			applied?.body ?? textBody(output?.text ?? '', 'text' as BundledLanguage),
		preview: missingPathPreview(path),
		title: 'Edit',
		tone: 'default',
	};
}

/**
 * Joins a command to the output it produced, marking the command lines with a
 * shell prompt so an expanded row reads as the transcript of one invocation
 * rather than as output whose cause scrolled off with the collapsed preview.
 *
 * The marker is `$` rather than `>` because the body is highlighted as bash,
 * where a leading `>` is the redirect operator and would colour the command as
 * a write into a file named after its first word.
 * @param command - The command line that ran
 * @param output - Everything the command wrote
 * @returns The transcript to render as the row's body
 */
function shellTranscript(command: string, output: string): string {
	const prompt = command
		.split('\n')
		.map((line) => `$ ${line}`)
		.join('\n');
	return output.length > 0 ? `${prompt}\n${output}` : prompt;
}

/**
 * Runs a shell command. The title says what the command does, the command line
 * itself stays the preview, and the body holds the command with its output.
 * @param part - The shell tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentBash(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const command = stringField(input, 'command', 'cmd');
	const commandLine = command ?? '(no command)';
	const output = outputOf(part);
	return {
		badge: null,
		body: textBody(
			shellTranscript(commandLine, output?.text ?? ''),
			'bash' as BundledLanguage,
		),
		preview: { font: 'mono', text: commandLine },
		title: command === null ? 'Bash' : shellCommandTitle(command),
		tone: 'default',
	};
}

/**
 * Searches file contents; the pattern is the preview, the matches the body.
 * @param part - The search tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentGrep(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const pattern = stringField(input, 'pattern', 'query', 'regex') ?? '(empty)';
	const path = stringField(input, 'path', 'glob', 'include');
	const output = outputOf(part);
	return {
		badge: fileBadge(path, 'folder'),
		body: textBody(output?.text ?? '', 'text' as BundledLanguage),
		preview: { font: 'mono', text: pattern },
		title: 'Search',
		tone: 'default',
	};
}

/**
 * Matches paths by glob; the pattern is the preview, the paths the body.
 * @param part - The `glob` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentGlob(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const pattern = stringField(input, 'pattern', 'glob') ?? '(empty)';
	const output = outputOf(part);
	return {
		badge: null,
		body: textBody(output?.text ?? '', 'text' as BundledLanguage),
		preview: { font: 'mono', text: pattern },
		title: 'Glob',
		tone: 'default',
	};
}

/**
 * Lists a directory; the folder stays pinned as a badge while the body reads.
 * @param part - The directory-listing tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentList(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const path = pathOf(input) ?? stringField(input, 'directory', 'dir');
	const output = outputOf(part);
	return {
		badge: fileBadge(path, 'folder'),
		body: textBody(output?.text ?? '', 'text' as BundledLanguage),
		preview: missingPathPreview(path),
		title: 'List',
		tone: 'default',
	};
}

/**
 * Reports language-server diagnostics for a file. A clean file has no body
 * worth opening, so it collapses to the title and its chip.
 * @param part - The `lsp_diagnostics` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentDiagnostics(part: DynamicToolUIPart): ToolPresenterResult {
	const output = outputOf(part);
	const path = pathOf(inputOf(part)) ?? pathOf(output?.details ?? {});
	const entries = parseToolDiagnostics(output?.details ?? null);
	const isClean = entries.length === 0;
	return {
		badge: fileBadge(path),
		body: isClean ? { kind: 'empty' } : { entries, kind: 'diagnostics' },
		preview: isClean ? { font: 'sans', text: 'No diagnostics' } : null,
		title: isClean
			? 'Diagnostics'
			: `${entries.length} diagnostic${entries.length === 1 ? '' : 's'}`,
		tone: entries.some((entry) => entry.severity === 'error')
			? 'destructive'
			: 'default',
	};
}

/**
 * Fallback for extension and MCP tools. Their name is already the title, so the
 * body carries both halves of the exchange: the arguments sent, then the reply.
 * @param part - The unrecognized tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentGeneric(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const output = outputOf(part);
	const text = output?.text ?? '';
	const classification = classifyToolOutput(part.toolName, text);
	const hasInput = Object.keys(input).length > 0;
	return {
		badge: null,
		body: hasInput
			? {
					kind: 'labeled',
					sections: [
						{ label: 'Input:', muted: true, text: formatInput(input) },
						{ label: 'Output:', muted: false, text },
					],
				}
			: textBody(
					classification.text,
					classification.language ?? ('text' as BundledLanguage),
				),
		preview: null,
		title: part.toolName || 'Tool',
		tone: 'default',
	};
}

const PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ToolPresenterResult
> = {
	bash: presentBash,
	cli: presentBash,
	edit: presentEdit,
	glob: presentGlob,
	grep: presentGrep,
	list_directory: presentList,
	ls: presentList,
	lsp_diagnostics: presentDiagnostics,
	read: presentRead,
	read_file: presentRead,
	run_command: presentBash,
	search: presentGrep,
	shell: presentBash,
	str_replace: presentEdit,
	str_replace_editor: presentEdit,
	view: presentRead,
	write: presentWrite,
	write_file: presentWrite,
};

/** Stands in when a failed call reported neither a reason nor any output. */
const UNSPECIFIED_FAILURE = 'The call failed without a reported reason.';

/**
 * Reads the message a failed call should render.
 *
 * A control tool reports a refusal as an ordinary result carrying `ok: false`
 * and never sets the transport's error text, so a row that trusts the error text
 * alone titles a denial as the action it was refused.
 * @param part - The tool part to inspect
 * @returns The failure message, or null when the call did not fail
 */
function failureTextOf(part: DynamicToolUIPart): string | null {
	if ('errorText' in part && part.errorText) {
		return part.errorText;
	}
	const controlFailure = ensemblrControlFailure(part);
	if (controlFailure === null) {
		return null;
	}
	const reported = controlFailure.error ?? outputOf(part)?.text ?? '';
	return reported.length > 0 ? reported : UNSPECIFIED_FAILURE;
}

/**
 * Resolves the icon a tool answers to at rest, before any failure is considered.
 * @param part - The tool part to identify
 * @returns The glyph for the tool's name
 */
function restingGlyph(part: DynamicToolUIPart): ToolGlyph {
	return (
		TOOL_GLYPHS[part.toolName.toLowerCase()] ??
		ensemblrToolGlyph(part.toolName) ??
		'wrench'
	);
}

/**
 * Projects any tool call into everything its row needs to render.
 *
 * Failures and in-flight calls short-circuit before the per-tool presenters:
 * a failed call reads the same whichever tool produced it, and a running one
 * has no result to shape yet. Otherwise a tool-specific presenter runs, falling
 * back to the generic extension shape for names the app does not know.
 *
 * A failure carrying a stack trace gets the frame-parsing viewer rather than a
 * flat block, so a several-hundred-line traceback collapses to its error line.
 * @param part - The tool part to project
 * @returns The row's icon, title, badge, preview, and body
 */
export function presentToolCall(part: DynamicToolUIPart): ToolPresentation {
	const failureText = failureTextOf(part);
	if (failureText !== null) {
		return {
			badge: null,
			body: looksLikeStackTrace(failureText)
				? { kind: 'stack-trace', trace: failureText }
				: { kind: 'error', text: failureText },
			glyph: 'circle-x',
			preview: { font: 'mono', text: failureText },
			title: `${humanizeToolName(part.toolName)} failed`,
			tone: 'destructive',
		};
	}
	const glyph = restingGlyph(part);
	const isRunning = RUNNING_STATES.has(part.state);
	const presenter = PRESENTERS[part.toolName.toLowerCase()] ?? presentGeneric;
	const projected = presenter(part);
	const controlLabel = ensemblrToolLabel(
		part.toolName,
		inputOf(part),
		isRunning,
	);
	const presentation = {
		...projected,
		glyph: projected.glyph ?? glyph,
		title: controlLabel?.title ?? projected.title,
	};
	if (isRunning) {
		return { ...presentation, body: { kind: 'pending' } };
	}
	return presentation;
}

/**
 * Resolves the icon a tool call reads as, without projecting its body. A turn
 * summary paints one of these per call, so it must stay cheap on turns holding
 * dozens of them.
 * @param part - The tool part to identify
 * @returns The glyph for the tool, or the failure mark when the call failed
 */
export function glyphForToolCall(part: DynamicToolUIPart): ToolGlyph {
	return failureTextOf(part) === null ? restingGlyph(part) : 'circle-x';
}

/**
 * Projects a reasoning block into the same row shape as a tool call, so
 * thinking and acting read as one timeline rather than two styles.
 * @param text - The raw reasoning markdown
 * @returns The row presentation for the reasoning block
 */
export function presentReasoning(text: string): ToolPresentation {
	return {
		badge: null,
		body: { kind: 'markdown', text },
		glyph: 'brain',
		preview: { font: 'sans', text },
		title: 'Thinking',
		tone: 'default',
	};
}

/**
 * Projects an extension-injected message into a row, so context an extension
 * pushed into the conversation announces itself without occupying the surface
 * the answer needs.
 *
 * An injector that set no `display` hint asked to stay out of the conversation,
 * so its row keeps the preview line empty: the title says something arrived,
 * and the payload waits behind the disclosure.
 * @param data - The injector's tag, visibility hint, and text
 * @returns The row presentation for the injected message
 */
export function presentCustomMessage(
	data: PiCustomMessageData,
): ToolPresentation {
	return {
		badge: null,
		body: { kind: 'markdown', text: data.text },
		glyph: 'puzzle',
		preview: data.display ? { font: 'sans', text: data.text } : null,
		title: humanizeToolName(data.customType),
		tone: 'default',
	};
}

/**
 * Projects a skill activation into a row, so a `/skill:name` invocation reads as
 * one line of turn activity — the skill named, marked "Skill activated" — rather
 * than the whole `SKILL.md` Pi expanded into the prompt. The body is empty: the
 * skill's effect is the turn that follows, not text to unfold.
 * @param name - The invoked skill's name
 * @returns The row presentation for the activation
 */
export function presentSkillInvocation(name: string): ToolPresentation {
	return {
		badge: null,
		body: { kind: 'empty' },
		glyph: 'biceps-flexed',
		preview: { font: 'mono', text: 'Skill activated' },
		title: humanizeToolName(name),
		tone: 'default',
	};
}
