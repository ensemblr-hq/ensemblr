import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { buildToolDiffRows } from '@/renderer/lib/diff/tool-rows';
import { i18n } from '@/renderer/lib/i18n';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import type {
	ToolBadgeDescriptor,
	ToolBodyDescriptor,
	ToolGlyph,
	ToolPresentation,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { isPreviewableImagePath } from '@/shared/preview-image';
import { ensemblrToolGlyph } from './ensemblr-tool-presentation';
import { parseNumberedFileBody } from './numbered-file-body';
import { shellCommandTitle } from './shell-command-title';
import { parseToolDiagnostics } from './tool-diagnostics';
import { classifyToolOutput } from './tool-output-classifier';
import {
	inputOf,
	numberField,
	outputOf,
	pathOf,
	stringField,
} from './tool-part-fields';

/**
 * One presenter per tool the app knows by name, and the mark each of them
 * answers to. `tool-presentation.ts` dispatches into this table once a call has
 * been shown to be neither a failure nor still in flight.
 */

/** Matches an ANSI colour escape, which only the terminal body can render. */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`);

/**
 * Matches the `read` tool's placeholder text for an image target ("Read image
 * file [image/png]") — the whole result, not file content to number as code.
 */
const IMAGE_READ_PLACEHOLDER = /^Read image file \[[^[\]]+\]$/;

/**
 * Icon each known tool answers to. Held apart from the presenters so a summary
 * strip can name a call's mark without projecting its body, which for a long
 * turn would mean re-serializing every payload on every render.
 */
const TOOL_GLYPHS: Record<string, ToolGlyph> = {
	agent: 'bot',
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
	skill: 'biceps-flexed',
	str_replace: 'file-pen',
	str_replace_editor: 'file-pen',
	task: 'bot',
	view: 'file-text',
	write: 'file-plus',
	write_file: 'file-plus',
};

/**
 * Everything a presenter decides. The glyph normally follows from the tool's
 * name, so it stays optional here; a presenter sets it only to override that
 * default, e.g. an image `read` marking itself distinctly from a text one.
 */
export type ToolPresenterResult = Omit<ToolPresentation, 'glyph'> & {
	glyph?: ToolGlyph;
};

/**
 * Builds the chip that pins a tool's target path to its row, trimmed so the same
 * file resolves against the workspace tree whichever tool named it.
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
	const named = path?.trim() ?? '';
	if (named.length === 0) {
		return null;
	}
	return {
		additions: counts?.additions ?? null,
		deletions: counts?.deletions ?? null,
		kind,
		path: named,
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
	return path === null
		? {
				font: 'mono',
				text: i18n.t('workbench:tool-call.placeholder.no-path', '(no path)'),
			}
		: null;
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
 * Whether a `read` call targeted an image rather than text, which no runtime
 * returns a numbered file body for — so a line-numbered code body and a "Read N
 * lines" title would both be fiction.
 *
 * Runtimes say so two different ways: Pi answers with a one-line placeholder,
 * while Claude Code returns the bytes as an image content block that the text
 * projection drops, leaving an empty result. A previewable extension is the only
 * signal left on that second path, and it counts only against that empty
 * projection — a runtime reporting a size limit or a truncation in the same
 * channel the placeholder arrives on has something to say, and an image row
 * would discard it.
 * @param path - Path the call read, or null when it named none
 * @param text - The call's projected result text
 * @returns True when the row should read as an image read
 */
function isImageRead(path: string | null, text: string): boolean {
	const projected = text.trim();
	if (IMAGE_READ_PLACEHOLDER.test(projected)) {
		return true;
	}
	return (
		projected.length === 0 && path !== null && isPreviewableImagePath(path)
	);
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
	if (isImageRead(path, text)) {
		return {
			badge: fileBadge(path),
			body: { kind: 'empty' },
			glyph: 'image',
			preview: missingPathPreview(path),
			title: i18n.t('workbench:tool-call.read.image', 'Read image'),
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
		title:
			lines > 0
				? i18n.t('workbench:tool-call.read.lines', {
						count: lines,
						defaultValue_one: 'Read {{count}} line',
						defaultValue_other: 'Read {{count}} lines',
					})
				: i18n.t('workbench:tool-call.read.title', 'Read'),
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
		title: i18n.t('workbench:tool-call.write.title', 'Write'),
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
		title: i18n.t('workbench:tool-call.edit.title', 'Edit'),
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
	const commandLine =
		command ??
		i18n.t('workbench:tool-call.placeholder.no-command', '(no command)');
	const output = outputOf(part);
	return {
		badge: null,
		body: textBody(
			shellTranscript(commandLine, output?.text ?? ''),
			'bash' as BundledLanguage,
		),
		preview: { font: 'mono', text: commandLine },
		title:
			command === null
				? i18n.t('workbench:tool-call.bash.title', 'Bash')
				: shellCommandTitle(command),
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
	const pattern =
		stringField(input, 'pattern', 'query', 'regex') ??
		i18n.t('workbench:tool-call.placeholder.empty-pattern', '(empty)');
	const path = stringField(input, 'path', 'glob', 'include');
	const output = outputOf(part);
	return {
		badge: fileBadge(path, 'folder'),
		body: textBody(output?.text ?? '', 'text' as BundledLanguage),
		preview: { font: 'mono', text: pattern },
		title: i18n.t('workbench:tool-call.grep.title', 'Search'),
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
	const pattern =
		stringField(input, 'pattern', 'glob') ??
		i18n.t('workbench:tool-call.placeholder.empty-pattern', '(empty)');
	const output = outputOf(part);
	return {
		badge: null,
		body: textBody(output?.text ?? '', 'text' as BundledLanguage),
		preview: { font: 'mono', text: pattern },
		title: i18n.t('workbench:tool-call.glob.title', 'Glob'),
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
		title: i18n.t('workbench:tool-call.list.title', 'List'),
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
		preview: isClean
			? {
					font: 'sans',
					text: i18n.t(
						'workbench:tool-call.diagnostics.none',
						'No diagnostics',
					),
				}
			: null,
		title: isClean
			? i18n.t('workbench:tool-call.diagnostics.clean', 'Diagnostics')
			: i18n.t('workbench:tool-call.diagnostics.count', {
					count: entries.length,
					defaultValue_one: '{{count}} diagnostic',
					defaultValue_other: '{{count}} diagnostics',
				}),
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
						{
							label: i18n.t(
								'workbench:tool-call.generic.input-label',
								'Input:',
							),
							muted: true,
							text: formatInput(input),
						},
						{
							label: i18n.t(
								'workbench:tool-call.generic.output-label',
								'Output:',
							),
							muted: false,
							text,
						},
					],
				}
			: textBody(
					classification.text,
					classification.language ?? ('text' as BundledLanguage),
				),
		preview: null,
		title: part.toolName || i18n.t('workbench:tool-call.generic.title', 'Tool'),
		tone: 'default',
	};
}

/**
 * Activates a packaged skill. The wire name is only ever `Skill`, so a turn that
 * reached for three of them reads as three identical rows; the skill it invoked
 * is the one thing the row has to say, and it travels in the arguments.
 *
 * Reads exactly as `presentSkillInvocation` reads the same act on the other
 * runtime: one inert line, nothing to unfold. The result this call returns is
 * the skill's own `SKILL.md` handed back to the caller — prompt rather than
 * output, and the turn that follows is where its effect shows.
 * @param part - The `skill` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentSkill(part: DynamicToolUIPart): ToolPresenterResult {
	const name = stringField(inputOf(part), 'skill', 'skill_name', 'name');
	return {
		badge: null,
		body: { kind: 'empty' },
		preview: null,
		title:
			name === null
				? i18n.t('workbench:tool-call.skill.title', 'Skill')
				: i18n.t('workbench:tool-call.skill.named', 'Skill: {{name}}', {
						name,
					}),
		tone: 'default',
	};
}

/**
 * Delegates a slice of the turn to a subagent. The wire name is the same for
 * every delegation, so a turn that spawned three of them would read as three
 * identical rows; what it was spawned as and what it was asked to do are the two
 * things that tell them apart, and both travel in the arguments.
 *
 * The result is the subagent's own closing report — prose, not a payload — so it
 * renders as markdown rather than the generic input/output JSON. The rows the
 * subagent produced along the way are nested into this one by the timeline, not
 * by the presenter.
 * @param part - The `task` tool part to project
 * @returns The row's title, badge, preview, and body
 */
function presentSubagent(part: DynamicToolUIPart): ToolPresenterResult {
	const input = inputOf(part);
	const subagentType = stringField(input, 'subagent_type', 'subagentType');
	const task = stringField(input, 'description', 'name', 'prompt');
	const report = outputOf(part)?.text.trim() ?? '';

	return {
		badge: null,
		body: report ? { kind: 'markdown', text: report } : { kind: 'empty' },
		preview: task === null ? null : { font: 'sans', text: task },
		title:
			subagentType === null
				? i18n.t('workbench:tool-call.subagent.title', 'Sub-agent')
				: i18n.t('workbench:tool-call.subagent.named', 'Sub-agent: {{type}}', {
						type: subagentType,
					}),
		tone: 'default',
	};
}

const PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ToolPresenterResult
> = {
	agent: presentSubagent,
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
	skill: presentSkill,
	str_replace: presentEdit,
	str_replace_editor: presentEdit,
	task: presentSubagent,
	view: presentRead,
	write: presentWrite,
	write_file: presentWrite,
};

/**
 * Picks the presenter that shapes a tool's row, falling back to the generic
 * extension shape for names the app does not know.
 * @param toolName - The tool name as the runtime reported it
 * @returns The presenter to project the call with
 */
export function presenterFor(
	toolName: string,
): (part: DynamicToolUIPart) => ToolPresenterResult {
	return PRESENTERS[toolName.toLowerCase()] ?? presentGeneric;
}

/**
 * Resolves the icon a tool answers to at rest, before any failure is considered.
 * @param part - The tool part to identify
 * @returns The glyph for the tool's name
 */
export function restingGlyph(part: DynamicToolUIPart): ToolGlyph {
	return (
		TOOL_GLYPHS[part.toolName.toLowerCase()] ??
		ensemblrToolGlyph(part.toolName) ??
		'wrench'
	);
}
