/**
 * Static catalog of AI coding-agent CLI harnesses Ensemblr can launch inside a
 * workspace terminal tab. This registry is the ONLY source of launch command
 * strings: the renderer sends a harness id, and the main process assembles the
 * command from the matching definition here. A renderer-supplied id is never
 * turned into free-text shell input, which keeps the always-on skip-permissions
 * flags from being an injection vector.
 */

/**
 * Identifies the on-disk session-log format a harness writes, used to derive its
 * conversation title when its OSC window title is not the title itself. Codex sets
 * the window title to its cwd and Mistral Vibe emits a static "Vibe", so both need
 * their title read from the harness's own log instead of the terminal stream.
 */
export type ConversationTitleSource = 'codex-rollout' | 'vibe-log';

/**
 * Identifies the on-disk session-log format a harness writes, used to read the
 * harness's native session id for the running conversation. Unlike
 * {@link ConversationTitleSource} this covers all harnesses (Claude included),
 * since the id is captured for every harness to enable exact-conversation resume
 * when restoring a closed tab. Claude records its id in the transcript filename
 * under `~/.claude/projects/`; Codex in its rollout log; Vibe in its session dir.
 */
export type SessionLogSource =
	| 'claude-transcript'
	| 'codex-rollout'
	| 'vibe-log';

/**
 * Characters allowed in a harness session id before it is spliced into a resume
 * command run under `sh -c`. Every harness id we read is a UUID or a slug of
 * `[A-Za-z0-9._-]`; rejecting anything else keeps a tampered persisted id from
 * becoming a shell-injection vector.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Reports whether a session id is safe to splice into a shell resume command.
 * @param sessionId - The candidate session id.
 * @returns True when the id contains only safe characters.
 */
export function isSafeHarnessSessionId(sessionId: string): boolean {
	return SAFE_SESSION_ID.test(sessionId);
}

/**
 * Where a harness's "busy" (mid-turn) state is observed. Most TUIs animate a
 * spinner glyph in their OSC window title, so the renderer reads busy from the
 * title. Mistral Vibe animates its spinner only in the terminal body, never the
 * title, so its busy is derived from the braille spinner glyphs streaming in the
 * PTY output instead. Defaults to `osc-title` when omitted.
 */
export type BusySource = 'osc-title' | 'pty-spinner';

/** One launchable coding-agent harness and how to invoke it. */
export interface HarnessDefinition {
	/** Stable identifier used as the IPC lookup key and tab metadata. */
	id: string;
	/** Human-readable name shown in the robot menu and on the tab. */
	label: string;
	/**
	 * Where to read this harness's conversation title when its OSC window title is
	 * unreliable. Omitted for harnesses whose window title already carries the
	 * conversation title (e.g. Claude Code), which use the OSC stream directly.
	 */
	conversationTitleSource?: ConversationTitleSource;
	/**
	 * Which on-disk session log to read this harness's native session id from, for
	 * exact-conversation resume. Set for every harness; omit only for a harness
	 * that persists no resumable session log.
	 */
	sessionLogSource?: SessionLogSource;
	/**
	 * Where this harness's busy (mid-turn) state is observed. Omitted → `osc-title`
	 * (a spinner glyph animated in the OSC window title). Set to `pty-spinner` for
	 * harnesses like Vibe that animate their spinner only in the terminal body.
	 */
	busySource?: BusySource;
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
	 * Builds the launch command that reattaches a prior conversation, keeping the
	 * auto-approve flag. With no `sessionId` it reattaches the harness's most
	 * recent conversation in the current working directory (used when respawning a
	 * tab after an app restart); with a `sessionId` it reattaches that exact
	 * conversation (used when restoring a closed tab). Omit for harnesses with no
	 * resume; callers then fall back to {@link buildCommand}.
	 * @param bin - The resolved binary name (or absolute path) to invoke.
	 * @param sessionId - Native harness session id to reattach exactly, if known.
	 * @returns The resume command string run under `sh -c` in the terminal PTY.
	 */
	buildResumeCommand?: (bin: string, sessionId?: string) => string;
}

/**
 * The launchable harnesses, in menu display order. Each `buildCommand` bakes in
 * the harness's auto-approve flag (per the product decision to always skip
 * permission prompts). Flags below were verified against each tool's current
 * official documentation (July 2026) — do not edit them from memory. Mistral
 * Vibe's flag surface is lower-confidence and worth reconfirming with `--help`.
 */
export const HARNESS_REGISTRY: readonly HarnessDefinition[] = [
	{
		// code.claude.com/docs/en/permission-modes
		id: 'claude',
		label: 'Claude Code',
		binaries: ['claude'],
		// Claude records its session id in the transcript filename under
		// `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`.
		sessionLogSource: 'claude-transcript',
		buildCommand: (bin) => `${bin} --dangerously-skip-permissions`,
		// code.claude.com/docs/en/cli-reference — `--continue` loads the most
		// recent conversation for the current directory; `--resume <id>` reattaches
		// an exact session.
		buildResumeCommand: (bin, sessionId) =>
			sessionId
				? `${bin} --dangerously-skip-permissions --resume ${sessionId}`
				: `${bin} --dangerously-skip-permissions --continue`,
	},
	{
		// developers.openai.com/codex/cli/reference — `--yolo` is the short alias.
		id: 'codex',
		label: 'OpenAI Codex',
		binaries: ['codex'],
		// Codex sets its OSC window title to the cwd, so read the title from the
		// rollout log it writes under `~/.codex/sessions/`.
		conversationTitleSource: 'codex-rollout',
		sessionLogSource: 'codex-rollout',
		buildCommand: (bin) => `${bin} --dangerously-bypass-approvals-and-sandbox`,
		// developers.openai.com/codex/cli/reference — `resume` is a subcommand:
		// `--last` skips the picker for the newest session, or a session id (UUID)
		// reattaches an exact session. The top-level flag precedes the subcommand.
		buildResumeCommand: (bin, sessionId) =>
			sessionId
				? `${bin} --dangerously-bypass-approvals-and-sandbox resume ${sessionId}`
				: `${bin} --dangerously-bypass-approvals-and-sandbox resume --last`,
	},
	{
		// docs.mistral.ai/vibe — built-in agent that auto-approves every tool.
		id: 'vibe',
		label: 'Mistral Vibe',
		binaries: ['vibe'],
		// Vibe emits a static "Vibe" as its OSC title, so read the auto-generated
		// title it persists in `~/.vibe/logs/session/*/meta.json`. Its spinner
		// animates only in the terminal body, so busy comes from PTY output.
		conversationTitleSource: 'vibe-log',
		sessionLogSource: 'vibe-log',
		busySource: 'pty-spinner',
		buildCommand: (bin) => `${bin} --agent auto-approve`,
		// docs.mistral.ai/vibe/code/cli/work-with-cli — `--continue` resumes the
		// most recent conversation for the directory; `--resume <id>` reattaches an
		// exact session (needs log_interactions=true, the default).
		buildResumeCommand: (bin, sessionId) =>
			sessionId
				? `${bin} --agent auto-approve --resume ${sessionId}`
				: `${bin} --agent auto-approve --continue`,
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

/**
 * Resolves the session-log title source for a harness id, if any. Used to decide
 * whether a tab should read its conversation title from disk instead of the OSC
 * window title.
 * @param id - The harness id to resolve.
 * @returns The title source, or null when the harness has no id or uses OSC.
 */
export function harnessConversationTitleSource(
	id: string | null | undefined,
): ConversationTitleSource | null {
	if (!id) {
		return null;
	}
	return findHarnessDefinition(id)?.conversationTitleSource ?? null;
}

/**
 * Resolves where a harness's busy state is observed, defaulting to the OSC-title
 * spinner when the harness declares no override.
 * @param id - The harness id to resolve.
 * @returns The busy source, or `osc-title` for an unknown or unset harness.
 */
export function harnessBusySource(id: string | null | undefined): BusySource {
	if (!id) {
		return 'osc-title';
	}
	return findHarnessDefinition(id)?.busySource ?? 'osc-title';
}

/**
 * Resolves the session-log source used to read a harness's native session id, if
 * any. Used to decide whether a tab should poll its session id for
 * exact-conversation resume.
 * @param id - The harness id to resolve.
 * @returns The session-log source, or null when the harness has no id or none.
 */
export function harnessSessionLogSource(
	id: string | null | undefined,
): SessionLogSource | null {
	if (!id) {
		return null;
	}
	return findHarnessDefinition(id)?.sessionLogSource ?? null;
}
