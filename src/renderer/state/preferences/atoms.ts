import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { atomFamily } from 'jotai-family';

import type { LinkedDirectory } from '@/renderer/types/workbench';

/** Behavior when the user submits a message mid-turn. */
export type FollowUpBehavior = 'steer' | 'queue' | 'block';

/** Keyboard shortcut for sending a message. */
export type SendShortcut = 'enter' | 'mod+enter';

/** Tool-call rendering mode in the conversation view. */
export type ToolCallCollapseMode = 'collapsed' | 'expanded';

/** Single-source store key prefix to avoid clashes with other Jotai atoms. */
const KEY = (suffix: string) => `ensemblr_pref_${suffix}`;

// ─── General ──────────────────────────────────────────────────────────────────
// All General settings now live in config.json (see ./app-settings). "Soften AI
// certainty" and "Show MCP status in chat" were removed from the UI; they had no
// functional consumers, so their atoms were dropped entirely.

// ─── Appearance ───────────────────────────────────────────────────────────────
// All Appearance settings now live in config.json (see ./app-settings); there
// are no Appearance atoms here.

// ─── Composer memory (per-chat overrides) ──────────────────────────────────────

/**
 * Per-chat model override, keyed by chat-tab id. `null` preserves an existing
 * session's model, or inherits the Settings default ({@link defaultChatModelAtom})
 * for a fresh chat. A non-null value is an explicit per-chat pick that survives
 * reloads. Picking a model in one chat never changes another chat's model.
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
 * Whether a chat is in Plan Mode, keyed by chat-tab id. This is the durable record
 * of what the user chose: it rides every `openAgentSession`/`submitAgentPrompt`
 * call into the main-process registry, which keeps no persistence of its own.
 *
 * `null` means the user has never decided for this tab, and is deliberately
 * distinct from `false`. A spawned conversation inherits its parent's Plan Mode
 * through the control layer, so main can hold a planning session the renderer has
 * no opinion about — and sending `false` for "no opinion" would clear it on the
 * user's first message. Main seeds the value over `agentControlPlanModeChanged`
 * when it spawns a planning child; a fresh chat, including one opened to implement
 * a handed-off plan, starts with no opinion and therefore unblocked.
 */
export const chatPlanModeAtomFamily = atomFamily((chatTabId: string) =>
	atomWithStorage<boolean | null>(KEY(`chat_plan_mode_${chatTabId}`), null),
);

/**
 * Whether the user has stepped away from a chat, keyed by chat-tab id. Plan
 * Mode's opposite number and stored the same way, for the same reasons: it is
 * the durable record of what the user chose, it rides every
 * `openAgentSession`/`submitAgentPrompt` call, and `null` means "never decided"
 * rather than "off" so a conversation that inherited AFK from an unattended
 * parent is not cleared by the user's first message into it.
 *
 * The two are mutually exclusive — planning exists to stop and ask, which is the
 * one thing AFK rules out — and the composer controller clears one when the
 * other is switched on.
 */
export const chatAfkModeAtomFamily = atomFamily((chatTabId: string) =>
	atomWithStorage<boolean | null>(KEY(`chat_afk_mode_${chatTabId}`), null),
);

/**
 * Directories outside the workspace this chat has been given access to, keyed by
 * chat-tab id. Like {@link chatPlanModeAtomFamily} this is the durable record of
 * the user's choice and rides every `openAgentSession` call; the main process
 * keeps no copy of its own.
 *
 * Deliberately per-chat rather than per-workspace: a linked directory widens what
 * the agent may read, so one chat silently changing another chat's reach would be
 * a permission surprise.
 */
export const chatLinkedDirectoriesAtomFamily = atomFamily((chatTabId: string) =>
	atomWithStorage<readonly LinkedDirectory[]>(
		KEY(`chat_linked_dirs_${chatTabId}`),
		[],
	),
);

/**
 * The linked directories that were in force when this chat's runtime session was
 * opened. Claude's SDK takes `additionalDirectories` only at launch, so a folder
 * linked mid-session is not readable until the chat reopens; comparing this with
 * {@link chatLinkedDirectoriesAtomFamily} is what lets the composer say so
 * instead of letting the agent hit an unexplained permission denial.
 *
 * `null` means no session has opened for this chat yet, which an empty array
 * cannot express — a chat whose session opened with nothing linked also stores
 * `[]`, and reading that as "never opened" would silence the warning for the
 * commonest case of all: send a message first, link a directory after.
 */
export const chatAppliedLinkedDirectoriesAtomFamily = atomFamily(
	(chatTabId: string) =>
		atomWithStorage<readonly string[] | null>(
			KEY(`chat_applied_linked_dirs_${chatTabId}`),
			null,
		),
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
	chatPlanModeAtomFamily.remove(chatTabId);
	chatAfkModeAtomFamily.remove(chatTabId);
	chatLinkedDirectoriesAtomFamily.remove(chatTabId);
	chatAppliedLinkedDirectoriesAtomFamily.remove(chatTabId);
	const storage =
		typeof globalThis.localStorage === 'undefined'
			? null
			: globalThis.localStorage;
	if (!storage) {
		return;
	}
	storage.removeItem(KEY(`chat_model_${chatTabId}`));
	storage.removeItem(KEY(`chat_thinking_${chatTabId}`));
	storage.removeItem(KEY(`chat_plan_mode_${chatTabId}`));
	storage.removeItem(KEY(`chat_afk_mode_${chatTabId}`));
	storage.removeItem(KEY(`chat_linked_dirs_${chatTabId}`));
	storage.removeItem(KEY(`chat_applied_linked_dirs_${chatTabId}`));
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

// ─── Run scripts (per-workspace memory) ───────────────────────────────────────

/**
 * Name of the run script last launched in a workspace, so the dock's Run button
 * and ⌘R keep targeting it across reloads. `null` falls back to the
 * repository's default script. Per workspace on purpose: two workspaces of one
 * repo commonly run different scripts.
 */
export const lastRunScriptAtomFamily = atomFamily((workspaceId: string) =>
	atomWithStorage<string | null>(KEY(`last_run_script_${workspaceId}`), null),
);

/** Shared prefix of every per-workspace last-run-script storage key. */
const LAST_RUN_SCRIPT_KEY_PREFIX = KEY('last_run_script_');

/**
 * Drops a workspace's remembered run script and its backing localStorage key.
 * Call when a workspace is deleted — `atomWithStorage` leaves the stored key
 * behind otherwise, so it would accumulate one key per workspace the install
 * has ever opened. Archiving keeps the memory, since the workspace can be
 * unarchived; {@link retainLastRunScripts} collects it once it cannot.
 */
export function forgetLastRunScript(workspaceId: string): void {
	lastRunScriptAtomFamily.remove(workspaceId);

	if (typeof globalThis.localStorage !== 'undefined') {
		globalThis.localStorage.removeItem(
			`${LAST_RUN_SCRIPT_KEY_PREFIX}${workspaceId}`,
		);
	}
}

/**
 * Drops the remembered run script of every workspace outside
 * `existingWorkspaceIds`, collecting keys whose workspace was removed by a
 * renderer that never ran {@link forgetLastRunScript} for it. The set must name
 * archived workspaces too, or unarchiving one loses its script.
 * @param existingWorkspaceIds - Every workspace still on record
 */
export function retainLastRunScripts(
	existingWorkspaceIds: ReadonlySet<string>,
): void {
	if (
		existingWorkspaceIds.size === 0 ||
		typeof globalThis.localStorage === 'undefined'
	) {
		return;
	}

	for (const workspaceId of storedLastRunScriptWorkspaceIds()) {
		if (!existingWorkspaceIds.has(workspaceId)) {
			forgetLastRunScript(workspaceId);
		}
	}
}

/**
 * Reads the workspace ids that currently hold a stored run-script key.
 * @returns Every workspace id carried by a `last_run_script_*` storage key
 */
function storedLastRunScriptWorkspaceIds(): string[] {
	const workspaceIds: string[] = [];

	for (let index = 0; index < globalThis.localStorage.length; index += 1) {
		const storageKey = globalThis.localStorage.key(index);

		if (storageKey?.startsWith(LAST_RUN_SCRIPT_KEY_PREFIX)) {
			workspaceIds.push(storageKey.slice(LAST_RUN_SCRIPT_KEY_PREFIX.length));
		}
	}

	return workspaceIds;
}

// ─── Git (user defaults) ──────────────────────────────────────────────────────
// Moved to config.json (see ./app-settings). The atoms previously here were
// localStorage-only with no consumers; they now back the `app.git` section and
// feed the repository settings resolver as the `user-default` source.

// ─── Quick start (user) ───────────────────────────────────────────────────────

/**
 * Organization the last quick-start project was published under, so a user who
 * works out of an organization is not sent back to their personal account on
 * every new project. `null` means the signed-in user, and is written back
 * whenever the personal account is picked, so the atom answers "does this user
 * publish into an organization?" rather than just naming the last owner. The
 * quick-start flow reads it that way twice: to preselect the organization, and
 * to decide whether Create is worth holding while `gh` answers. The stored
 * login is only honoured when it still appears in the owner list and can still
 * receive repositories, so revoked access falls back rather than failing at
 * publish.
 */
export const lastQuickStartOwnerAtom = atomWithStorage<string | null>(
	KEY('last_quick_start_owner'),
	null,
);

// ─── Diff viewer (user) ────────────────────────────────────────────────────────

/** Column layout of the diff viewer: one unified column or side-by-side split. */
type DiffLayout = 'unified' | 'split';

/**
 * Whether the diff viewer lays out changes in one unified column or side-by-side;
 * app-wide and persisted so the chosen layout sticks across files and reloads.
 */
export const diffLayoutAtom = atomWithStorage<DiffLayout>(
	KEY('diff_layout'),
	'unified',
);

/**
 * Whether the diff viewer reveals hidden characters (tabs, carriage returns) as
 * visible glyphs; app-wide and persisted across files and reloads.
 */
export const diffShowWhitespaceAtom = atomWithStorage<boolean>(
	KEY('diff_show_whitespace'),
	false,
);

/**
 * Whether the diff viewer soft-wraps long lines instead of scrolling them
 * horizontally; app-wide and persisted across files and reloads.
 */
export const diffWordWrapAtom = atomWithStorage<boolean>(
	KEY('diff_word_wrap'),
	false,
);

// ─── File preview (user) ───────────────────────────────────────────────────────

/**
 * Whether the read-only file preview soft-wraps long lines instead of scrolling
 * them horizontally; app-wide and persisted across files and reloads. Mirrors
 * {@link diffWordWrapAtom}, but stays a separate key so wrapping a minified file
 * in a preview tab does not reflow every diff the user opens next.
 */
export const filePreviewWordWrapAtom = atomWithStorage<boolean>(
	KEY('file_preview_word_wrap'),
	false,
);

/**
 * Whether the read-only file preview renders a `.md` file's formatted preview
 * instead of its raw source; app-wide and persisted across files and reloads.
 * Defaults off, matching every other file type's plain-source view.
 */
export const filePreviewMarkdownPreviewAtom = atomWithStorage<boolean>(
	KEY('file_preview_markdown_preview'),
	false,
);

// ─── Experimental (user) ──────────────────────────────────────────────────────
// Moved to config.json (see ./app-settings): `experimental.developerMode` joins
// `experimental.autoRunAfterSetup` so both Experimental rows are reachable from
// the header's "Edit in config.json" and survive a cleared localStorage.

// ─── Advanced (user) ──────────────────────────────────────────────────────────

// Pi executable path and terminal scrollback moved off localStorage: Pi path is
// the SQLite `pi.executablePath` setting (read/set/cleared over IPC), and
// scrollback is the `appearance.terminalScrollbackMb` config.json setting.

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
	'filesToCopy',
	'previewUrls',
	'security.permissionMode',
	'scripts.setup',
	'scripts.run',
	'scripts.runScripts',
	'scripts.archive',
	'runScriptMode',
	'autoRunAfterSetup',
	'actionPreferences.branchRename',
	'actionPreferences.codeReview',
	'actionPreferences.createPr',
	'actionPreferences.fixErrors',
	'actionPreferences.general',
	'actionPreferences.resolveConflicts',
] as const;
/** One of the known repo-scope setting keys resolvable from the settings snapshot. */
export type RepoSettingsKey = (typeof REPO_SETTINGS_KEYS)[number];

/**
 * Personal per-repo overrides still stored locally. Git, files-to-copy, and
 * preview-URL overrides moved to repository-scoped SQLite (resolved via
 * {@link useRepoSettings}); only per-action instruction overrides remain here,
 * and the committed `[prompts]` config merges *under* them. Spotlight testing
 * is a separate, unbuilt feature — it will model its own state when it lands.
 */
export interface RepoSettingsOverride {
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
/** One of the per-repo action keys that can carry custom agent instructions. */
export type RepoActionKey = (typeof REPO_ACTION_KEYS)[number];

/** Personal per-repository setting overrides, keyed by repo id and persisted to localStorage. */
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
