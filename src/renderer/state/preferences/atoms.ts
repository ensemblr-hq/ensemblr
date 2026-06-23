import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { atomFamily } from 'jotai-family';

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
// All General settings now live in config.json (see ./app-settings). "Soften AI
// certainty" and "Show MCP status in chat" were removed from the UI; they had no
// functional consumers, so their atoms were dropped entirely.

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

// ─── Composer memory (per-chat overrides) ──────────────────────────────────────

/**
 * Per-chat model override, keyed by chat-tab id. `null` means "inherit the
 * Settings → Default model" ({@link defaultChatModelAtom}); a non-null value is
 * an explicit per-chat pick that survives reloads and is preserved for that
 * chat only. Picking a model in one chat never changes another chat's model.
 */
export const chatModelOverrideAtomFamily = atomFamily((chatTabId: string) =>
	atomWithStorage<string | null>(KEY(`chat_model_${chatTabId}`), null),
);

/**
 * Per-chat thinking-level override, keyed by chat-tab id. Mirrors
 * {@link chatModelOverrideAtomFamily}; `null` inherits the Settings default
 * ({@link defaultChatThinkingLevelAtom}).
 */
export const chatThinkingOverrideAtomFamily = atomFamily((chatTabId: string) =>
	atomWithStorage<string | null>(KEY(`chat_thinking_${chatTabId}`), null),
);

/**
 * Drops a chat's per-chat override atoms and their backing localStorage keys.
 * Call only when a chat tab is permanently deleted — closed tabs are restorable
 * and must keep their overrides. `atomFamily.remove` evicts just the in-memory
 * atom; `atomWithStorage` leaves the stored key behind, so the keys are removed
 * explicitly to keep storage bounded across the install's lifetime.
 */
export function forgetChatOverrides(chatTabId: string): void {
	chatModelOverrideAtomFamily.remove(chatTabId);
	chatThinkingOverrideAtomFamily.remove(chatTabId);
	const storage =
		typeof globalThis.localStorage === 'undefined'
			? null
			: globalThis.localStorage;
	if (!storage) {
		return;
	}
	storage.removeItem(KEY(`chat_model_${chatTabId}`));
	storage.removeItem(KEY(`chat_thinking_${chatTabId}`));
}

// ─── Models (user defaults) ───────────────────────────────────────────────────
// Default/review model + thinking and the hidden-models list now live in
// config.json (see ./app-settings). Favourites stay here: they're toggled from
// the composer star, not the Settings page.

/**
 * Favourited model ids, pinned to the top of the model picker. App-wide and
 * shared across every workspace/chat (single global storage key, no scoping).
 * Order is the order models were starred.
 */
export const favouriteModelsAtom = atomWithStorage<string[]>(
	KEY('favourite_models'),
	[],
);

// ─── Git (user defaults) ──────────────────────────────────────────────────────
// Moved to config.json (see ./app-settings). The atoms previously here were
// localStorage-only with no consumers; they now back the `app.git` section and
// feed the repository settings resolver as the `user-default` source.

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

// ─── Pull request details (per-workspace local draft) ──────────────────────────

/** Locally-saved PR title/description for a workspace's Checks panel. */
export interface PrDetailsDraft {
	description: string;
	title: string;
}

/**
 * Per-workspace saved PR title/description, keyed by workspace id. `null` means
 * "nothing saved" — the Checks panel then seeds its inputs from the open PR (if
 * any). Saving persists across reloads so a drafted title/description isn't lost
 * on navigation; "Create PR" reads the live inputs, not this atom.
 */
export const prDetailsDraftAtomFamily = atomFamily((workspaceId: string) =>
	atomWithStorage<PrDetailsDraft | null>(
		KEY(`pr_details_${workspaceId}`),
		null,
	),
);

/** Live (possibly unsaved) PR draft mirrored from the Checks panel inputs. */
export interface PrDetailsLiveDraft {
	description: string;
	/**
	 * `${workspaceId}:${prNumber ?? 'none'}` — guards a cross-surface read against
	 * a draft left over from a different PR identity (e.g. after one is opened).
	 */
	identity: string;
	title: string;
}

/**
 * In-memory mirror of the Checks panel's *live* PR title/description, keyed by
 * workspace id. The Checks form publishes every edit here so other surfaces —
 * notably the sidebar "Create PR" menu — hand the agent exactly what the user is
 * currently editing, not just the last Saved draft. Deliberately not persisted:
 * after a reload, surfaces fall back to {@link prDetailsDraftAtomFamily}.
 */
export const prDetailsLiveDraftAtomFamily = atomFamily((_workspaceId: string) =>
	atom<PrDetailsLiveDraft | null>(null),
);
