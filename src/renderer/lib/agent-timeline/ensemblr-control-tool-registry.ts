import { i18n } from '@/renderer/lib/i18n';
import type { ToolGlyph } from '@/renderer/types/tool-presentation';

/**
 * The table of what the app's own control tools are called in the timeline.
 *
 * The `ensemblr_*` tools drive the app rather than the repository, so the
 * generic extension row serves them badly: it titles the row with the raw wire
 * name and unfolds the whole argument payload, which for a session summary means
 * pretty-printing several thousand characters of markdown the user already has.
 * This module holds the label and mark each one deserves, and names the three
 * that should not appear at all.
 *
 * The hidden set is the bookkeeping the app asks for on its own behalf — naming
 * the tab, naming the workspace and branch, recording the session summary. The
 * user did not request it, its result is already visible as the tab title or the
 * branch name, and a row for it costs the turn a line of attention. Hiding it
 * also keeps a turn's closing prose where the user can read it: the timeline
 * promotes only the run of text that follows the turn's last visible tool call,
 * so a summary call filed after the answer would fold that answer away.
 *
 * Every lookup goes through {@link canonicalEnsemblrToolName} rather than the
 * reported name, because only one of the two runtimes reports the name the
 * control extension registered. This module is the data half of the concern;
 * `ensemblr-tool-presentation.ts` reads it and is the entrypoint the rest of the
 * app imports.
 */

/** Wire-name prefix shared by every tool the app's control extension registers. */
const CONTROL_TOOL_PREFIX = 'ensemblr_';

/** Wire names of the bookkeeping calls the timeline omits when they succeed. */
export const BOOKKEEPING_TOOL_NAMES: ReadonlySet<string> = new Set([
	'ensemblr_set_branch_name',
	'ensemblr_set_name',
	'ensemblr_set_summary',
]);

/**
 * Title and mark for one control tool, before its arguments are read.
 *
 * The title is held as a pair of resolvers rather than as one finished string so
 * that a call still in flight reads in the present participle —
 * `ensemblr_wait_for_agents` blocks for as long as its children run, and "Waited
 * for sub-agents" over a turn that is still working describes something that has
 * not happened yet. Pairing the two forms in a tuple makes a missing tense a type
 * error, and each form is a whole sentence rather than a verb joined to an object
 * because a locale that inflects the object cannot be served by concatenation.
 */
interface EnsemblrToolLabel {
	glyph: ToolGlyph;
	/** The title as `[settled, in flight]`, each resolved in the active language. */
	title: readonly [() => string, () => string];
	/**
	 * Input paths whose value is appended to the title, first match winning. A
	 * path may step into a batch — `comments.0.filePath` — so a call that carries
	 * its subject inside an array still names it.
	 */
	detailKeys?: readonly string[];
	/**
	 * Input paths whose value is a workspace file, pinned as a clickable chip
	 * rather than appended to the title — the same chip a `write` or an `edit`
	 * row carries, so a path reads and opens the same way whichever tool named
	 * it. Independent of {@link EnsemblrToolLabel.detailKeys}: a call naming both
	 * a file and an argument, as `open_tab` names a file and a variant, shows the
	 * two in their own slots rather than spending the title on the path.
	 */
	pathKeys?: readonly string[];
}

/**
 * The label each control tool answers to. Titles read as the action taken rather
 * than the tool called, because the user is watching the app being driven and
 * has no use for the name of the lever. Glyphs name the action too, so a folded
 * turn's strip of marks distinguishes starting a terminal from stopping one.
 *
 * Detail keys are the canonical argument names from
 * `src/shared/agent-control/arg-naming.ts`, followed by the near-misses that
 * table forgives — the boundary rewrites `file` to `filePath` before the op
 * runs, but the timeline records the arguments as the model actually sent them.
 */
export const ENSEMBLR_TOOL_LABELS: Record<string, EnsemblrToolLabel> = {
	ensemblr_ask_user_question: {
		detailKeys: ['questions.0.question'],
		glyph: 'message-circle-question',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.ask-user-question.done',
					'Asked you a question',
				),
			() =>
				i18n.t(
					'workbench:control-tool.ask-user-question.running',
					'Asking you a question',
				),
		],
	},
	ensemblr_close_tab: {
		glyph: 'square-x',
		title: [
			() => i18n.t('workbench:control-tool.close-tab.done', 'Closed a tab'),
			() => i18n.t('workbench:control-tool.close-tab.running', 'Closing a tab'),
		],
	},
	ensemblr_exit_plan_mode: {
		detailKeys: ['title'],
		glyph: 'clipboard-list',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.exit-plan-mode.done',
					'Submitted a plan',
				),
			() =>
				i18n.t(
					'workbench:control-tool.exit-plan-mode.running',
					'Submitting a plan',
				),
		],
	},
	ensemblr_focus_dock_tab: {
		detailKeys: ['kind'],
		glyph: 'crosshair',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.focus-dock-tab.done',
					'Focused a terminal',
				),
			() =>
				i18n.t(
					'workbench:control-tool.focus-dock-tab.running',
					'Focusing a terminal',
				),
		],
	},
	ensemblr_focus_panel: {
		detailKeys: ['panel'],
		glyph: 'crosshair',
		title: [
			() =>
				i18n.t('workbench:control-tool.focus-panel.done', 'Focused a panel'),
			() =>
				i18n.t(
					'workbench:control-tool.focus-panel.running',
					'Focusing a panel',
				),
		],
	},
	ensemblr_focus_tab: {
		glyph: 'crosshair',
		title: [
			() => i18n.t('workbench:control-tool.focus-tab.done', 'Focused a tab'),
			() =>
				i18n.t('workbench:control-tool.focus-tab.running', 'Focusing a tab'),
		],
	},
	ensemblr_add_diff_comments: {
		glyph: 'message-square-plus',
		pathKeys: ['comments.*.filePath'],
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.add-diff-comments.done',
					'Left review comments',
				),
			() =>
				i18n.t(
					'workbench:control-tool.add-diff-comments.running',
					'Leaving review comments',
				),
		],
	},
	ensemblr_resolve_diff_comments: {
		glyph: 'message-square-check',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.resolve-diff-comments.done',
					'Resolved review comments',
				),
			() =>
				i18n.t(
					'workbench:control-tool.resolve-diff-comments.running',
					'Resolving review comments',
				),
		],
	},
	ensemblr_get_conversation_status: {
		glyph: 'bot',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.get-conversation-status.done',
					'Checked a sub-agent',
				),
			() =>
				i18n.t(
					'workbench:control-tool.get-conversation-status.running',
					'Checking a sub-agent',
				),
		],
	},
	ensemblr_get_diff_comments: {
		glyph: 'message-square-text',
		pathKeys: ['filePath', 'file', 'path'],
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.get-diff-comments.done',
					'Read review comments',
				),
			() =>
				i18n.t(
					'workbench:control-tool.get-diff-comments.running',
					'Reading review comments',
				),
		],
	},
	ensemblr_get_last_message: {
		glyph: 'bot',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.get-last-message.done',
					"Read a sub-agent's report",
				),
			() =>
				i18n.t(
					'workbench:control-tool.get-last-message.running',
					"Reading a sub-agent's report",
				),
		],
	},
	ensemblr_get_workspace_diff: {
		glyph: 'file-diff',
		pathKeys: ['filePath', 'file', 'path'],
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.get-workspace-diff.done',
					'Read the diff',
				),
			() =>
				i18n.t(
					'workbench:control-tool.get-workspace-diff.running',
					'Reading the diff',
				),
		],
	},
	ensemblr_get_workspace_status: {
		glyph: 'kanban',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.get-workspace-status.done',
					'Read board status',
				),
			() =>
				i18n.t(
					'workbench:control-tool.get-workspace-status.running',
					'Reading board status',
				),
		],
	},
	ensemblr_launch_harness: {
		detailKeys: ['harnessId'],
		glyph: 'square-terminal',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.launch-harness.done',
					'Launched a harness',
				),
			() =>
				i18n.t(
					'workbench:control-tool.launch-harness.running',
					'Launching a harness',
				),
		],
	},
	ensemblr_linear_create_comment: {
		detailKeys: ['issueId', 'id', 'identifier'],
		glyph: 'message-square-plus',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.linear-create-comment.done',
					'Commented on a Linear issue',
				),
			() =>
				i18n.t(
					'workbench:control-tool.linear-create-comment.running',
					'Commenting on a Linear issue',
				),
		],
	},
	ensemblr_linear_get_issue: {
		detailKeys: ['issueId', 'id', 'identifier'],
		glyph: 'ticket',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.linear-get-issue.done',
					'Read a Linear issue',
				),
			() =>
				i18n.t(
					'workbench:control-tool.linear-get-issue.running',
					'Reading a Linear issue',
				),
		],
	},
	ensemblr_linear_get_metadata: {
		glyph: 'list',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.linear-get-metadata.done',
					'Read Linear teams and states',
				),
			() =>
				i18n.t(
					'workbench:control-tool.linear-get-metadata.running',
					'Reading Linear teams and states',
				),
		],
	},
	ensemblr_linear_list_issues: {
		detailKeys: ['query', 'search'],
		glyph: 'ticket',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.linear-list-issues.done',
					'Searched Linear issues',
				),
			() =>
				i18n.t(
					'workbench:control-tool.linear-list-issues.running',
					'Searching Linear issues',
				),
		],
	},
	ensemblr_linear_update_issue: {
		detailKeys: ['issueId', 'id', 'identifier'],
		glyph: 'ticket-check',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.linear-update-issue.done',
					'Updated a Linear issue',
				),
			() =>
				i18n.t(
					'workbench:control-tool.linear-update-issue.running',
					'Updating a Linear issue',
				),
		],
	},
	ensemblr_list_models: {
		glyph: 'list',
		title: [
			() => i18n.t('workbench:control-tool.list-models.done', 'Listed models'),
			() =>
				i18n.t('workbench:control-tool.list-models.running', 'Listing models'),
		],
	},
	ensemblr_list_run_scripts: {
		glyph: 'list',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.list-run-scripts.done',
					'Listed run scripts',
				),
			() =>
				i18n.t(
					'workbench:control-tool.list-run-scripts.running',
					'Listing run scripts',
				),
		],
	},
	ensemblr_list_tabs: {
		glyph: 'list',
		title: [
			() => i18n.t('workbench:control-tool.list-tabs.done', 'Listed tabs'),
			() => i18n.t('workbench:control-tool.list-tabs.running', 'Listing tabs'),
		],
	},
	ensemblr_list_terminals: {
		glyph: 'list',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.list-terminals.done',
					'Listed terminals',
				),
			() =>
				i18n.t(
					'workbench:control-tool.list-terminals.running',
					'Listing terminals',
				),
		],
	},
	ensemblr_list_workspaces: {
		glyph: 'list',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.list-workspaces.done',
					'Listed workspaces',
				),
			() =>
				i18n.t(
					'workbench:control-tool.list-workspaces.running',
					'Listing workspaces',
				),
		],
	},
	ensemblr_notify_orchestrator: {
		detailKeys: ['reason'],
		glyph: 'bell',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.notify-orchestrator.done',
					'Notified the orchestrator',
				),
			() =>
				i18n.t(
					'workbench:control-tool.notify-orchestrator.running',
					'Notifying the orchestrator',
				),
		],
	},
	ensemblr_open_tab: {
		detailKeys: ['variant'],
		glyph: 'panels-top-left',
		pathKeys: ['filePath', 'file', 'path'],
		title: [
			() => i18n.t('workbench:control-tool.open-tab.done', 'Opened a tab'),
			() => i18n.t('workbench:control-tool.open-tab.running', 'Opening a tab'),
		],
	},
	ensemblr_read_conversation: {
		glyph: 'bot',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.read-conversation.done',
					"Read a sub-agent's transcript",
				),
			() =>
				i18n.t(
					'workbench:control-tool.read-conversation.running',
					"Reading a sub-agent's transcript",
				),
		],
	},
	ensemblr_read_terminal_output: {
		glyph: 'scroll-text',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.read-terminal-output.done',
					'Read terminal output',
				),
			() =>
				i18n.t(
					'workbench:control-tool.read-terminal-output.running',
					'Reading terminal output',
				),
		],
	},
	ensemblr_send_follow_up: {
		glyph: 'send',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.send-follow-up.done',
					'Steered a sub-agent',
				),
			() =>
				i18n.t(
					'workbench:control-tool.send-follow-up.running',
					'Steering a sub-agent',
				),
		],
	},
	ensemblr_set_workspace_status: {
		detailKeys: ['status'],
		glyph: 'kanban',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.set-workspace-status.done',
					'Moved the workspace',
				),
			() =>
				i18n.t(
					'workbench:control-tool.set-workspace-status.running',
					'Moving the workspace',
				),
		],
	},
	ensemblr_spawn_chat_tab: {
		detailKeys: ['title'],
		glyph: 'panels-top-left',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.spawn-chat-tab.done',
					'Opened a chat tab',
				),
			() =>
				i18n.t(
					'workbench:control-tool.spawn-chat-tab.running',
					'Opening a chat tab',
				),
		],
	},
	ensemblr_start_conversation: {
		detailKeys: ['title'],
		glyph: 'bot',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.start-conversation.done',
					'Started a sub-agent',
				),
			() =>
				i18n.t(
					'workbench:control-tool.start-conversation.running',
					'Starting a sub-agent',
				),
		],
	},
	ensemblr_start_terminal: {
		detailKeys: ['scriptName', 'kind'],
		glyph: 'play',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.start-terminal.done',
					'Started a terminal',
				),
			() =>
				i18n.t(
					'workbench:control-tool.start-terminal.running',
					'Starting a terminal',
				),
		],
	},
	ensemblr_stop_terminal: {
		detailKeys: ['kind'],
		glyph: 'circle-stop',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.stop-terminal.done',
					'Stopped a terminal',
				),
			() =>
				i18n.t(
					'workbench:control-tool.stop-terminal.running',
					'Stopping a terminal',
				),
		],
	},
	ensemblr_wait_for_agents: {
		glyph: 'hourglass',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.wait-for-agents.done',
					'Waited for sub-agents',
				),
			() =>
				i18n.t(
					'workbench:control-tool.wait-for-agents.running',
					'Waiting for sub-agents',
				),
		],
	},
	ensemblr_write_terminal: {
		detailKeys: ['input'],
		glyph: 'keyboard',
		title: [
			() =>
				i18n.t(
					'workbench:control-tool.write-terminal.done',
					'Typed into a terminal',
				),
			() =>
				i18n.t(
					'workbench:control-tool.write-terminal.running',
					'Typing into a terminal',
				),
		],
	},
};

/**
 * Every control tool the timeline has a label for, so a test can hold the whole
 * registry to the same contract rather than a hand-copied sample of it.
 */
export const ENSEMBLR_CONTROL_TOOL_NAMES: readonly string[] =
	Object.keys(ENSEMBLR_TOOL_LABELS);

/** Every name the control extension registers, label-bearing or bookkeeping. */
const CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set([
	...ENSEMBLR_CONTROL_TOOL_NAMES,
	...BOOKKEEPING_TOOL_NAMES,
]);

/**
 * Reduces the name a runtime reported to the name the control extension
 * registered the tool under.
 *
 * The two runtimes disagree about what to call the same tool. Pi loads the
 * extension in-process and reports `ensemblr_set_name`; Claude Code reaches the
 * control server over MCP, where the SDK namespaces every tool by its server and
 * reports `mcp__ensemblr__ensemblr_set_name`. Matching only the bare form left
 * every call from the second runtime titled with its wire name and marked with
 * the generic wrench.
 *
 * Taking the last `ensemblr_` segment resolves both shapes, and the registry
 * check keeps that slice honest: an unrelated tool whose name happens to carry
 * the prefix resolves to nothing rather than borrowing a label.
 * @param toolName - The tool name as the runtime reported it
 * @returns The registered name, or null when the tool is not a control tool
 */
export function canonicalEnsemblrToolName(toolName: string): string | null {
	const lowered = toolName.toLowerCase();
	const start = lowered.lastIndexOf(CONTROL_TOOL_PREFIX);
	if (start === -1) {
		return null;
	}
	const registered = lowered.slice(start);
	return CONTROL_TOOL_NAMES.has(registered) ? registered : null;
}
