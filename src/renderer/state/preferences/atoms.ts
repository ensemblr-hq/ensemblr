import { atomFamily, atomWithStorage } from 'jotai/utils';

/** Visual color scheme. `system` follows OS preference; otherwise overrides. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** Accessible color palette variant for color-vision differences. */
export type AccessibleColorVariant =
	| 'default'
	| 'protanopia'
	| 'deuteranopia'
	| 'tritanopia';

/** Behavior when the user submits a message mid-turn. */
export type FollowUpBehavior = 'steer' | 'queue' | 'block';

/** Keyboard shortcut for sending a message. */
export type SendShortcut = 'enter' | 'mod+enter';

/** Built-in completion sound choices. */
export type CompletionSound = 'off' | 'chime' | 'chime-2' | 'soft-ding' | 'pop';

/** Tool-call rendering mode in the conversation view. */
export type ToolCallCollapseMode = 'collapsed' | 'expanded';

/** Code editor / diff syntax highlight theme. */
export type CodeTheme =
	| 'catppuccin-mocha'
	| 'catppuccin-latte'
	| 'github-dark'
	| 'github-light'
	| 'one-dark'
	| 'solarized-dark';

/** Markdown renderer preset. */
export type MarkdownStyle = 'default' | 'compact' | 'prose';

/** Single-source store key prefix to avoid clashes with other Jotai atoms. */
const KEY = (suffix: string) => `ensemble_pref_${suffix}`;

// ─── General ──────────────────────────────────────────────────────────────────

export const sendShortcutAtom = atomWithStorage<SendShortcut>(
	KEY('send_shortcut'),
	'enter',
);
export const followUpBehaviorAtom = atomWithStorage<FollowUpBehavior>(
	KEY('follow_up'),
	'steer',
);
export const desktopNotificationsAtom = atomWithStorage<boolean>(
	KEY('desktop_notifications'),
	true,
);
export const completionSoundAtom = atomWithStorage<CompletionSound>(
	KEY('completion_sound'),
	'chime-2',
);
export const autoConvertLongTextAtom = atomWithStorage<boolean>(
	KEY('auto_convert_long_text'),
	true,
);
export const softenCertaintyAtom = atomWithStorage<boolean>(
	KEY('soften_certainty'),
	false,
);
export const alwaysShowContextUsageAtom = atomWithStorage<boolean>(
	KEY('always_show_context'),
	true,
);
export const caffeinateWhileRunningAtom = atomWithStorage<boolean>(
	KEY('caffeinate'),
	false,
);
export const showMcpStatusInChatAtom = atomWithStorage<boolean>(
	KEY('show_mcp_status'),
	true,
);
export const toolCallCollapseAtom = atomWithStorage<ToolCallCollapseMode>(
	KEY('tool_call_collapse'),
	'collapsed',
);

// ─── Appearance ───────────────────────────────────────────────────────────────

export const themeAtom = atomWithStorage<ThemeMode>(KEY('theme'), 'system');
export const coloredSidebarDiffsAtom = atomWithStorage<boolean>(
	KEY('colored_sidebar_diffs'),
	false,
);
export const accessibleColorsAtom = atomWithStorage<AccessibleColorVariant>(
	KEY('accessible_colors'),
	'default',
);
export const codeThemeAtom = atomWithStorage<CodeTheme>(
	KEY('code_theme'),
	'catppuccin-mocha',
);
export const monoFontAtom = atomWithStorage<string>(
	KEY('mono_font'),
	'JetBrains Mono',
);
export const codeLigaturesAtom = atomWithStorage<boolean>(
	KEY('code_ligatures'),
	true,
);
export const markdownStyleAtom = atomWithStorage<MarkdownStyle>(
	KEY('markdown_style'),
	'default',
);
export const terminalFontAtom = atomWithStorage<string>(
	KEY('terminal_font'),
	'JetBrains Mono',
);
export const terminalFontSizeAtom = atomWithStorage<number>(
	KEY('terminal_font_size'),
	12,
);

// ─── Composer memory ──────────────────────────────────────────────────────────

/**
 * Persisted last-used Pi model id, shared across every workspace and chat tab.
 * Picking a model anywhere updates this single value so a fresh chat opens with
 * the same model the user picked last.
 */
export const lastSelectedPiModelAtom = atomWithStorage<string | null>(
	KEY('last_selected_pi_model'),
	null,
);

/**
 * Persisted last-used Pi thinking-level, shared across every workspace and
 * chat tab. Mirrors {@link lastSelectedPiModelAtom} for the thinking control.
 */
export const lastSelectedPiThinkingLevelAtom = atomWithStorage<string | null>(
	KEY('last_selected_pi_thinking_level'),
	null,
);

// ─── Models (user defaults) ───────────────────────────────────────────────────

export type PiPersonality = 'pragmatic' | 'thorough' | 'concise';
export type ChatModeDefault = 'none' | 'plan' | 'fast';

/** Default model id for new chats (resolved against Pi readiness at use-site). */
export const defaultChatModelAtom = atomWithStorage<string | null>(
	KEY('default_chat_model'),
	null,
);
export const defaultChatThinkingLevelAtom = atomWithStorage<string | null>(
	KEY('default_chat_thinking'),
	null,
);
export const reviewModelAtom = atomWithStorage<string | null>(
	KEY('review_model'),
	null,
);
export const reviewThinkingLevelAtom = atomWithStorage<string | null>(
	KEY('review_thinking'),
	null,
);
export const piPersonalityAtom = atomWithStorage<PiPersonality>(
	KEY('pi_personality'),
	'pragmatic',
);
export const defaultChatModeAtom = atomWithStorage<ChatModeDefault>(
	KEY('default_chat_mode'),
	'none',
);

// ─── Git (user defaults) ──────────────────────────────────────────────────────

export type BranchPrefixSource = 'github-username' | 'custom' | 'none';

export const branchPrefixSourceAtom = atomWithStorage<BranchPrefixSource>(
	KEY('branch_prefix_source'),
	'github-username',
);
export const branchPrefixCustomAtom = atomWithStorage<string>(
	KEY('branch_prefix_custom'),
	'',
);
export const renameWorkspaceOnBranchAtom = atomWithStorage<boolean>(
	KEY('rename_on_branch'),
	true,
);
export const deleteBranchOnArchiveAtom = atomWithStorage<boolean>(
	KEY('delete_branch_on_archive'),
	false,
);
export const archiveOnMergeAtom = atomWithStorage<boolean>(
	KEY('archive_on_merge'),
	false,
);
export const setUpstreamOnPushAtom = atomWithStorage<boolean>(
	KEY('set_upstream_on_push'),
	true,
);

// ─── Experimental (user) ──────────────────────────────────────────────────────

export const showSidebarResourceUsageAtom = atomWithStorage<boolean>(
	KEY('exp_sidebar_resource_usage'),
	false,
);
export const showDashboardAtom = atomWithStorage<boolean>(
	KEY('exp_show_dashboard'),
	true,
);
export const sidebarChatsModeAtom = atomWithStorage<boolean>(
	KEY('exp_sidebar_chats_mode'),
	false,
);
export const autoRunAfterSetupAtom = atomWithStorage<boolean>(
	KEY('exp_auto_run_after_setup'),
	false,
);
export const inAppBrowserPreviewAtom = atomWithStorage<boolean>(
	KEY('exp_in_app_browser_preview'),
	false,
);

// ─── Advanced (user) ──────────────────────────────────────────────────────────

export const customPiExecutablePathAtom = atomWithStorage<string>(
	KEY('pi_executable_override'),
	'',
);
export const terminalScrollbackMbAtom = atomWithStorage<number>(
	KEY('terminal_scrollback_mb'),
	10,
);

// ─── Repository overrides (per-repo, personal) ────────────────────────────────

/**
 * Known repo-scope setting keys queried from the resolution snapshot. Constrains
 * callers of `resolved(key)` so a typo fails the type-check instead of silently
 * returning `undefined` and blanking the source badge.
 */
const REPO_SETTINGS_KEYS = [
	'branchFrom',
	'remoteOrigin',
	'deleteLocalBranchOnArchive',
	'archiveAfterMerge',
	'setupScript',
	'runScript',
	'archiveScript',
	'runMode',
] as const;
export type RepoSettingsKey = (typeof REPO_SETTINGS_KEYS)[number];

/**
 * Personal per-repo overrides stored locally. The real source of truth lives
 * in repository config files (ensemble.json / conductor.json) and SQLite —
 * these atoms only hold user-only personal preferences until edited through
 * the shared config writer.
 */
export interface RepoSettingsOverride {
	branchFrom?: string;
	remoteOrigin?: string;
	setupScript?: string;
	runScript?: string;
	archiveScript?: string;
	runMode?: 'concurrent' | 'non-concurrent';
	autoRunAfterSetup?: boolean;
	useSpotlight?: boolean;
	filesToCopy?: string;
	previewUrls?: Array<{ name: string; url: string }>;
	actionPreferences?: Partial<Record<RepoActionKey, string>>;
}

export const REPO_ACTION_KEYS = [
	'codeReview',
	'createPr',
	'fixErrors',
	'resolveConflicts',
	'branchRename',
	'general',
] as const;
export type RepoActionKey = (typeof REPO_ACTION_KEYS)[number];

export const repoSettingsOverrideAtomFamily = atomFamily((repoId: string) =>
	atomWithStorage<RepoSettingsOverride>(KEY(`repo_override_${repoId}`), {}),
);
