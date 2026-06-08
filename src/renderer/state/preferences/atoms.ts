import { atomWithStorage } from 'jotai/utils';

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

// ─── Settings UI state ────────────────────────────────────────────────────────

/** Last-selected repository id when viewing repo-scope settings; `null` falls back to first available. */
export const settingsActiveRepoIdAtom = atomWithStorage<string | null>(
	KEY('active_repo_id'),
	null,
);
