import type { DynamicToolUIPart } from 'ai';
import type { ToolPresenterResult } from '@/renderer/types/tool-presentation';
import {
	type ControlRow,
	controlAck,
} from './ensemblr-control-presenter-helpers';
import { canonicalEnsemblrToolName } from './ensemblr-control-tool-registry';
import { ENSEMBLR_LINEAR_TOOL_PRESENTERS } from './ensemblr-linear-tool-presenters';
import { ENSEMBLR_SESSION_TOOL_PRESENTERS } from './ensemblr-session-tool-presenters';
import { ENSEMBLR_WORKSPACE_TOOL_PRESENTERS } from './ensemblr-workspace-tool-presenters';
import { presentWorkspaceDiff } from './workspace-diff-tool-presenter';

/**
 * Which presenter shapes the body of one of the app's own control-tool rows.
 *
 * Control tools reach the timeline under two names — the bare
 * `ensemblr_list_models` the Pi extension registers, and the
 * `mcp__ensemblr__ensemblr_list_models` an MCP client namespaces it as — so
 * this table is keyed by the canonical name {@link canonicalEnsemblrToolName}
 * resolves, never by the name a runtime happened to report. The reported-name
 * table in `tool-presenters.ts` cannot serve both, which is why the one control
 * presenter that existed before this module needed a hand-written branch.
 *
 * A control op with no entry here is not a gap. Most of them answer a bare
 * `{ ok: true }`, and a row whose payload says only that it worked has nothing
 * to unfold: {@link controlAck} gives it an empty body, and the arguments stay
 * reachable in the raw disclosure every control row carries.
 */

/** The body-and-preview presenters, by canonical control tool name. */
const CONTROL_ROW_PRESENTERS: Record<
	string,
	(part: DynamicToolUIPart) => ControlRow
> = {
	...ENSEMBLR_SESSION_TOOL_PRESENTERS,
	...ENSEMBLR_WORKSPACE_TOOL_PRESENTERS,
	...ENSEMBLR_LINEAR_TOOL_PRESENTERS,
};

/**
 * Turns a raw control tool name into a readable title, for the row whose tool
 * the label registry does not name. Every op that reaches the timeline has a
 * label today, so this stands in for one added later rather than for one of the
 * ops shipped now.
 * @param canonicalName - The canonical control tool name
 * @returns The humanized title
 */
function fallbackTitle(canonicalName: string): string {
	const words = canonicalName.replace(/^ensemblr_/, '').replace(/_+/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Lifts a body-and-preview presenter into the full row shape the timeline
 * projects, supplying the fields the label registry owns.
 *
 * Badge and title are placeholders by design: `presentToolCall` replaces both
 * with what `ensemblrToolLabel` resolved against the surface and the target
 * conversation's role, which is the one place that knows whether a row acted on
 * a sub-agent, a peer, or the Review conversation.
 * @param canonicalName - The canonical control tool name
 * @param present - The presenter shaping this op's body
 * @returns The full presenter
 */
function liftControlRow(
	canonicalName: string,
	present: (part: DynamicToolUIPart) => ControlRow,
): (part: DynamicToolUIPart) => ToolPresenterResult {
	return (part) => ({
		badge: null,
		...present(part),
		title: fallbackTitle(canonicalName),
		tone: 'default',
	});
}

/**
 * Picks the presenter for one of the app's own control tools.
 *
 * `ensemblr_get_workspace_diff` is the one op whose presenter resolves its own
 * badge — it parses the patch for the added and removed counts the file chip
 * paints — so it is returned whole rather than lifted.
 * @param toolName - The tool name as the runtime reported it
 * @returns The presenter, or null when the name is not a control tool
 */
export function controlToolPresenter(
	toolName: string,
): ((part: DynamicToolUIPart) => ToolPresenterResult) | null {
	const canonicalName = canonicalEnsemblrToolName(toolName);
	if (canonicalName === null) {
		return null;
	}
	if (canonicalName === 'ensemblr_get_workspace_diff') {
		return presentWorkspaceDiff;
	}
	return liftControlRow(
		canonicalName,
		CONTROL_ROW_PRESENTERS[canonicalName] ?? controlAck,
	);
}
