/**
 * Static catalog of AI coding-agent CLI harnesses Ensemblr can launch inside a
 * workspace terminal tab. This registry is the ONLY source of launch command
 * strings: the renderer sends a harness id, and the main process assembles the
 * command from the matching definition here. A renderer-supplied id is never
 * turned into free-text shell input, which keeps the always-on skip-permissions
 * flags from being an injection vector.
 */

/** One launchable coding-agent harness and how to invoke it. */
export interface HarnessDefinition {
	/** Stable identifier used as the IPC lookup key and tab metadata. */
	id: string;
	/** Human-readable name shown in the robot menu and on the tab. */
	label: string;
	/**
	 * Candidate executable names to probe on PATH, in priority order. The first
	 * one present on the machine is used to build the launch command.
	 */
	binaries: readonly string[];
	/**
	 * Builds the full launch command for a resolved binary, including the
	 * always-on "skip permissions / auto-approve" flag for that harness.
	 * @param bin - The resolved binary name (or absolute path) to invoke.
	 * @returns The command string run under `sh -c` in the terminal PTY.
	 */
	buildCommand: (bin: string) => string;
	/**
	 * Builds the launch command that reattaches the harness's most recent
	 * conversation in the current working directory, keeping the auto-approve
	 * flag. Used when respawning a tab after an app restart. Omit for harnesses
	 * with no cwd-scoped resume; callers then fall back to {@link buildCommand}.
	 * @param bin - The resolved binary name (or absolute path) to invoke.
	 * @returns The resume command string run under `sh -c` in the terminal PTY.
	 */
	buildResumeCommand?: (bin: string) => string;
}

/**
 * The launchable harnesses, in menu display order. Each `buildCommand` bakes in
 * the harness's auto-approve flag (per the product decision to always skip
 * permission prompts). Flags below were verified against each tool's current
 * official documentation (July 2026) — do not edit them from memory. Two are
 * lower-confidence and worth reconfirming with the tool's own `--help`:
 * `cursor-agent --force` and Mistral Vibe's flag surface.
 */
export const HARNESS_REGISTRY: readonly HarnessDefinition[] = [
	{
		// code.claude.com/docs/en/permission-modes
		id: 'claude',
		label: 'Claude Code',
		binaries: ['claude'],
		buildCommand: (bin) => `${bin} --dangerously-skip-permissions`,
		// code.claude.com/docs/en/cli-reference — `--continue` loads the most
		// recent conversation for the current directory.
		buildResumeCommand: (bin) =>
			`${bin} --dangerously-skip-permissions --continue`,
	},
	{
		// developers.openai.com/codex/cli/reference — `--yolo` is the short alias.
		id: 'codex',
		label: 'OpenAI Codex',
		binaries: ['codex'],
		buildCommand: (bin) => `${bin} --dangerously-bypass-approvals-and-sandbox`,
		// developers.openai.com/codex/cli/reference — `resume` is a subcommand and
		// `--last` skips the picker for the newest session; the top-level flag
		// precedes the subcommand.
		buildResumeCommand: (bin) =>
			`${bin} --dangerously-bypass-approvals-and-sandbox resume --last`,
	},
	{
		// google-gemini.github.io/gemini-cli — `--yolo` == `--approval-mode=yolo`.
		id: 'gemini',
		label: 'Gemini CLI',
		binaries: ['gemini'],
		buildCommand: (bin) => `${bin} --yolo`,
		// geminicli.com/docs/cli/session-management — `--resume` with no argument
		// loads the latest session for the current directory.
		buildResumeCommand: (bin) => `${bin} --yolo --resume`,
	},
	{
		// aider.chat/docs/config/options.html — auto-confirms every prompt.
		id: 'aider',
		label: 'Aider',
		binaries: ['aider'],
		buildCommand: (bin) => `${bin} --yes-always`,
		// aider.chat/docs/config/options.html — `--restore-chat-history` replays
		// the prior chat history from `.aider.chat.history.md` (default off).
		buildResumeCommand: (bin) => `${bin} --yes-always --restore-chat-history`,
	},
	{
		// opencode.ai/docs/cli — `--auto` is the most-permissive built-in switch
		// (still honors explicit deny rules; opencode has no full-bypass flag).
		id: 'opencode',
		label: 'opencode',
		binaries: ['opencode'],
		buildCommand: (bin) => `${bin} --auto`,
		// opencode.ai/docs/cli — `--continue` continues the last session.
		buildResumeCommand: (bin) => `${bin} --auto --continue`,
	},
	{
		// cursor.com/docs/cli/using — `--force` auto-approves tool execution.
		id: 'cursor',
		label: 'Cursor Agent',
		binaries: ['cursor-agent'],
		buildCommand: (bin) => `${bin} --force`,
		// cursor.com/docs/cli/using — `resume` reattaches the latest conversation.
		buildResumeCommand: (bin) => `${bin} --force resume`,
	},
	{
		// docs.mistral.ai/vibe — built-in agent that auto-approves every tool.
		id: 'vibe',
		label: 'Mistral Vibe',
		binaries: ['vibe'],
		buildCommand: (bin) => `${bin} --agent auto-approve`,
		// docs.mistral.ai/vibe/code/cli/work-with-cli — `--continue` resumes the
		// most recent conversation for the directory (needs log_interactions=true,
		// the default).
		buildResumeCommand: (bin) => `${bin} --agent auto-approve --continue`,
	},
];

/**
 * Looks up a harness definition by id.
 * @param id - The harness id to resolve.
 * @returns The matching definition, or undefined when the id is unknown.
 */
export function findHarnessDefinition(
	id: string,
): HarnessDefinition | undefined {
	return HARNESS_REGISTRY.find((harness) => harness.id === id);
}
