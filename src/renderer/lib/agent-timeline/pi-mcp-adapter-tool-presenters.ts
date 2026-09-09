import type { DynamicToolUIPart } from 'ai';
import type { BundledLanguage } from 'shiki';
import { i18n } from '@/renderer/lib/i18n';
import type {
	ToolBodyDescriptor,
	ToolPresenterResult,
	ToolPreviewDescriptor,
} from '@/renderer/types/tool-presentation';
import { inputOf, outputOf, stringField } from './tool-part-fields';
import { classifiedToolOutputBody, textBody } from './tool-presenter-helpers';

/** Presenter signature used by Pi MCP adapter timeline projections. */
type McpToolPresenter = (part: DynamicToolUIPart) => ToolPresenterResult;

/** Fixed entrypoints registered by the Pi MCP adapter. */
const FIXED_MCP_PRESENTERS: Readonly<Record<string, McpToolPresenter>> = {
	mcp: presentMcpGateway,
	mcpscript: presentMcpScript,
};

/** Initialization failures emitted before a direct tool can name its server. */
const UNSCOPED_MCP_ERRORS: ReadonlySet<string> = new Set([
	'init_failed',
	'not_initialized',
]);

/**
 * Reads the server from Pi's one-tool-per-server namespace shape.
 * @param toolName - Runtime tool name to inspect
 * @returns Server name for `mcp__<server>`, excluding Claude's two-part wrapper
 */
function namespaceProxyServer(toolName: string): string | null {
	const normalizedName = toolName.toLowerCase();
	if (!normalizedName.startsWith('mcp__')) {
		return null;
	}
	const server = toolName.slice('mcp__'.length);
	return server.length > 0 && !server.includes('__') ? server : null;
}

/**
 * Identifies a direct-tool initialization failure before server metadata exists.
 * @param details - Adapter result metadata
 * @returns True for stable unscoped initialization error codes
 */
function hasUnscopedMcpError(
	details: Readonly<Record<string, unknown>>,
): boolean {
	const error = stringField(details, 'error');
	return error !== null && UNSCOPED_MCP_ERRORS.has(error);
}

/**
 * Identifies Claude Code's server-and-tool MCP wrapper shape.
 * @param toolName - Runtime tool name to inspect
 * @returns True for `mcp__<server>__<tool>` names
 */
function isClaudeMcpToolName(toolName: string): boolean {
	const normalizedName = toolName.toLowerCase();
	return (
		normalizedName.startsWith('mcp__') &&
		normalizedName.slice('mcp__'.length).includes('__')
	);
}

/**
 * Checks for adapter metadata tied to a known server.
 * @param details - Adapter result metadata
 * @returns True when a server accompanies a target or adapter error
 */
function hasScopedMcpMetadata(
	details: Readonly<Record<string, unknown>>,
): boolean {
	const server = stringField(details, 'server');
	const target = stringField(details, 'tool', 'resourceUri');
	return server !== null && (target !== null || details.error !== undefined);
}

/**
 * Identifies a dynamically registered direct MCP call from adapter metadata.
 * @param part - Tool call whose runtime name may have a configurable prefix
 * @returns True for fixed, namespace-proxy, and metadata-identified direct calls
 */
function isPiMcpAdapterToolPart(part: DynamicToolUIPart): boolean {
	if (resolvePiMcpAdapterTool(part.toolName) !== null) {
		return true;
	}
	if (isClaudeMcpToolName(part.toolName)) {
		return false;
	}
	const details = outputOf(part)?.details;
	return (
		details !== null &&
		details !== undefined &&
		(hasUnscopedMcpError(details) || hasScopedMcpMetadata(details))
	);
}

/**
 * Resolves a Pi MCP adapter tool from its stable runtime name.
 * @param toolName - Runtime tool name to resolve
 * @returns Its presenter, or null for unrelated and Claude-wrapped tools
 */
export function resolvePiMcpAdapterTool(
	toolName: string,
): ((part: DynamicToolUIPart) => ToolPresenterResult) | null {
	return (
		FIXED_MCP_PRESENTERS[toolName.toLowerCase()] ??
		(namespaceProxyServer(toolName) === null ? null : presentMcpCall)
	);
}

/**
 * Resolves fixed, namespace-proxy, and dynamic direct Pi MCP adapter calls.
 * @param part - Tool call to inspect by name and result metadata
 * @returns Its presenter, or null for an unrelated call
 */
export function resolvePiMcpAdapterToolPart(
	part: DynamicToolUIPart,
): ((part: DynamicToolUIPart) => ToolPresenterResult) | null {
	return (
		resolvePiMcpAdapterTool(part.toolName) ??
		(isPiMcpAdapterToolPart(part) ? presentMcpCall : null)
	);
}

/**
 * Detects complete JSON output so adapter payloads receive JSON highlighting.
 * @param text - Adapter output text to inspect
 * @returns True when the complete output parses as JSON
 */
function isJsonOutput(text: string): boolean {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Projects adapter output into the standard classified body variants.
 * @param part - MCP tool part that produced the output
 * @returns A classified body, or an empty body before output arrives
 */
function mcpOutputBody(part: DynamicToolUIPart): ToolBodyDescriptor {
	const text = outputOf(part)?.text ?? '';
	if (text.length === 0) {
		return { kind: 'empty' };
	}
	if (isJsonOutput(text)) {
		return textBody(text, 'json' as BundledLanguage);
	}
	return classifiedToolOutputBody(part.toolName, text);
}

/**
 * Detects adapter failures carried in structured result details.
 * @param part - MCP tool part whose details should be inspected
 * @returns True when the adapter reported an error field
 */
function hasMcpError(part: DynamicToolUIPart): boolean {
	const details = outputOf(part)?.details;
	return (
		details !== null && details !== undefined && details.error !== undefined
	);
}

/**
 * Reads the most useful adapter failure text from output or metadata.
 * @param part - MCP tool part that failed
 * @returns Human-readable error text, or an empty string when none was reported
 */
function mcpErrorText(part: DynamicToolUIPart): string {
	const output = outputOf(part);
	return (
		output?.text || stringField(output?.details ?? {}, 'message', 'error') || ''
	);
}

/**
 * Applies shared output and failure presentation to an MCP activity.
 * @param part - MCP tool part to project
 * @param title - Localized activity title
 * @param preview - Useful collapsed summary of the action
 * @returns A complete MCP presenter result
 */
function presentMcpOutput(
	part: DynamicToolUIPart,
	title: string,
	preview: ToolPreviewDescriptor | null,
): ToolPresenterResult {
	const failed = hasMcpError(part);
	return {
		badge: null,
		body: failed
			? { kind: 'error', text: mcpErrorText(part) }
			: mcpOutputBody(part),
		preview,
		title,
		tone: failed ? 'destructive' : 'default',
	};
}

/**
 * Builds a collapsed preview from meaningful MCP action values.
 * @param values - Optional values to join in display order
 * @param font - Typography for prose or machine-readable values
 * @returns A preview descriptor, or null when no values are available
 */
function mcpPreview(
	values: readonly (string | null)[],
	font: 'mono' | 'sans' = 'sans',
): ToolPreviewDescriptor | null {
	const visibleValues = values.filter(
		(value): value is string => value !== null,
	);
	return visibleValues.length === 0
		? null
		: { font, text: visibleValues.join(' · ') };
}

/**
 * Formats an MCP target in the adapter's canonical `server/tool` notation.
 * @param server - MCP server name, when known
 * @param tool - Underlying MCP tool name, when known
 * @returns Monospaced target preview, or null without either identifier
 */
function mcpToolPreview(
	server: string | null,
	tool: string | null,
): ToolPreviewDescriptor | null {
	const identifiers = [server, tool].filter(
		(value): value is string => value !== null,
	);
	return identifiers.length === 0
		? null
		: { font: 'mono', text: identifiers.join('/') };
}

/**
 * Names and summarizes the operation selected by the MCP gateway arguments.
 * @param input - Gateway argument record
 * @returns The localized title and compact action preview
 */
function mcpGatewayAction(input: Record<string, unknown>): {
	preview: ToolPreviewDescriptor | null;
	title: string;
} {
	const server = stringField(input, 'server');
	const action = stringField(input, 'action');
	const actionTitles: Readonly<Record<string, string>> = {
		'auth-complete': i18n.t(
			'workbench:tool-call.mcp.auth-complete-title',
			'Complete MCP sign-in',
		),
		'auth-start': i18n.t(
			'workbench:tool-call.mcp.auth-start-title',
			'Start MCP sign-in',
		),
		'ui-messages': i18n.t(
			'workbench:tool-call.mcp.ui-messages-title',
			'Read MCP UI messages',
		),
	};
	const actionTitle = action === null ? null : actionTitles[action];
	if (actionTitle !== null && actionTitle !== undefined) {
		return { preview: mcpPreview([server]), title: actionTitle };
	}
	const tool = stringField(input, 'tool');
	const connect = stringField(input, 'connect');
	const describe = stringField(input, 'describe');
	const instructions = stringField(input, 'instructions');
	const search = stringField(input, 'search');
	const candidates = [
		{
			presentation: {
				preview: mcpToolPreview(server, tool),
				title: i18n.t('workbench:tool-call.mcp.call-title', 'Call MCP tool'),
			},
			value: tool,
		},
		{
			presentation: {
				preview: mcpPreview([connect]),
				title: i18n.t(
					'workbench:tool-call.mcp.connect-title',
					'Connect MCP server',
				),
			},
			value: connect,
		},
		{
			presentation: {
				preview: mcpPreview([describe], 'mono'),
				title: i18n.t(
					'workbench:tool-call.mcp.describe-title',
					'Describe MCP tool',
				),
			},
			value: describe,
		},
		{
			presentation: {
				preview: mcpPreview([instructions]),
				title: i18n.t(
					'workbench:tool-call.mcp.instructions-title',
					'Read MCP instructions',
				),
			},
			value: instructions,
		},
		{
			presentation: {
				preview: mcpPreview([search, server]),
				title: i18n.t(
					'workbench:tool-call.mcp.search-title',
					'Search MCP tools',
				),
			},
			value: search,
		},
		{
			presentation: {
				preview: mcpPreview([server]),
				title: i18n.t('workbench:tool-call.mcp.list-title', 'List MCP tools'),
			},
			value: server,
		},
	];
	return (
		candidates.find(({ value }) => value !== null)?.presentation ?? {
			preview: null,
			title: i18n.t('workbench:tool-call.mcp.status-title', 'MCP status'),
		}
	);
}

/**
 * Presents the Pi MCP gateway according to the action encoded in its arguments.
 * @param part - The `mcp` tool part to project
 * @returns The gateway action, preview, and classified output
 */
function presentMcpGateway(part: DynamicToolUIPart): ToolPresenterResult {
	const action = mcpGatewayAction(inputOf(part));
	return presentMcpOutput(part, action.title, action.preview);
}

/**
 * Resolves the server and underlying tool for a namespace-proxy call.
 * @param part - Namespace-proxy MCP tool part to inspect
 * @returns A monospaced `server/tool` preview when either payload identifies it
 */
function mcpCallPreview(part: DynamicToolUIPart): ToolPreviewDescriptor | null {
	const input = inputOf(part);
	const details = outputOf(part)?.details ?? {};
	const server =
		stringField(details, 'server') ??
		stringField(input, 'server') ??
		namespaceProxyServer(part.toolName);
	const directToolName =
		resolvePiMcpAdapterTool(part.toolName) === null ? part.toolName : null;
	const tool =
		stringField(details, 'tool', 'resourceUri') ??
		stringField(input, 'tool') ??
		directToolName;
	return mcpToolPreview(server, tool);
}

/**
 * Presents a direct namespace-proxy MCP invocation without exposing its arguments.
 * @param part - The `mcp__<server>` tool part to project
 * @returns The called server/tool and classified output
 */
function presentMcpCall(part: DynamicToolUIPart): ToolPresenterResult {
	return presentMcpOutput(
		part,
		i18n.t('workbench:tool-call.mcp.call-title', 'Call MCP tool'),
		mcpCallPreview(part),
	);
}

/**
 * Reads the first source line from an MCP script for its collapsed preview.
 * @param code - Full submitted JavaScript source
 * @returns The first source line, or null for an empty script
 */
function firstScriptLine(code: string): string | null {
	return (
		code
			.split('\n')
			.find((line) => line.trim().length > 0)
			?.trim() ?? null
	);
}

/**
 * Presents an MCP script as separately labeled source and output sections.
 * @param part - The `mcpScript` tool part to project
 * @returns The script title, first-line preview, source, and emitted output
 */
function presentMcpScript(part: DynamicToolUIPart): ToolPresenterResult {
	const code = stringField(inputOf(part), 'code') ?? '';
	const failed = hasMcpError(part);
	const text = failed ? mcpErrorText(part) : (outputOf(part)?.text ?? '');
	return {
		badge: null,
		body: {
			kind: 'labeled',
			sections: [
				{
					label: i18n.t('workbench:tool-call.mcp.script-label', 'Script:'),
					muted: true,
					text: code,
				},
				{
					label: i18n.t('workbench:tool-call.generic.output-label', 'Output:'),
					muted: false,
					text,
				},
			],
		},
		preview: mcpPreview([firstScriptLine(code)], 'mono'),
		title: i18n.t('workbench:tool-call.mcp.script-title', 'Run MCP script'),
		tone: failed ? 'destructive' : 'default',
	};
}
