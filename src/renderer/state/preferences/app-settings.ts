import { atom, useSetAtom } from 'jotai';
import { useEffect } from 'react';

import {
	getAppSettings,
	subscribeAppSettingsChanged,
	updateAppSettings,
} from '@/renderer/api/ensemblr';
import {
	type AppSettings,
	type AppSettingsPatch,
	DEFAULT_APP_SETTINGS,
} from '@/shared/config';

/**
 * Renderer mirror of the App settings persisted in `config.json` (the source of
 * truth in the main process). Hydrated once at app start and kept in sync with
 * external edits by {@link useAppSettingsSync}. Writes go through IPC; the local
 * copy updates optimistically so the UI stays instant.
 */
export const appSettingsAtom = atom<AppSettings>(DEFAULT_APP_SETTINGS);

/**
 * Builds a writable atom over one `config.json` setting. Reads project the
 * mirror; writes optimistically update the mirror and persist the patch via IPC,
 * re-syncing from disk if the write fails.
 */
function settingAtom<
	Section extends keyof AppSettings,
	Key extends keyof AppSettings[Section],
>(section: Section, key: Key) {
	/** Value type of the targeted `config.json` setting. */
	type Value = AppSettings[Section][Key];
	// Accept a direct value or an updater fn, matching the `atomWithStorage`
	// setter API these atoms replaced so existing call sites keep working.
	/** Either a replacement value or an updater function for a setting. */
	type Update = Value | ((prev: Value) => Value);
	return atom(
		(get) => get(appSettingsAtom)[section][key],
		(get, set, update: Update) => {
			const current = get(appSettingsAtom);
			const value =
				typeof update === 'function'
					? (update as (prev: Value) => Value)(current[section][key])
					: update;
			set(appSettingsAtom, {
				...current,
				[section]: { ...current[section], [key]: value },
			});
			const patch = { [section]: { [key]: value } } as AppSettingsPatch;
			void updateAppSettings(patch).catch(() => {
				void getAppSettings()
					.then((settings) => set(appSettingsAtom, settings))
					.catch(() => undefined);
			});
		},
	);
}

// ─── Concierge ───────────────────────────────────────────────────────────────
/**
 * Agent runtime the Concierge opens on. Written alongside {@link conciergeModelAtom}
 * rather than picked separately: a model belongs to exactly one runtime, and a
 * pair that disagrees is refused at session open.
 */
export const conciergeProviderAtom = settingAtom('concierge', 'provider');
/** Model the Concierge opens on; `null` takes the runtime's own default. */
export const conciergeModelAtom = settingAtom('concierge', 'model');
/** Thinking level the Concierge opens on; `null` takes the runtime's default. */
export const conciergeThinkingLevelAtom = settingAtom(
	'concierge',
	'thinkingLevel',
);
/** Share of the context window that trips the Concierge's automatic clear. */
export const conciergeAutoClearAtPercentAtom = settingAtom(
	'concierge',
	'autoClearAtPercent',
);

// ─── General ──────────────────────────────────────────────────────────────────
export const sendShortcutAtom = settingAtom('general', 'sendShortcut');
export const followUpBehaviorAtom = settingAtom('general', 'followUpBehavior');
/** UI language preference; `system` defers to the OS language order. */
export const languageAtom = settingAtom('general', 'language');
export const desktopNotificationsAtom = settingAtom(
	'general',
	'desktopNotifications',
);
/** Whether a chat needing attention plays the app's notification chime. */
export const notificationSoundAtom = settingAtom(
	'general',
	'notificationSound',
);
export const autoConvertLongTextAtom = settingAtom(
	'general',
	'autoConvertLongText',
);
export const alwaysShowContextUsageAtom = settingAtom(
	'general',
	'alwaysShowContextUsage',
);
export const caffeinateWhileRunningAtom = settingAtom(
	'general',
	'caffeinateWhileRunning',
);
/**
 * Whether Ensemblr may update itself. Off is a hard off — no check, no
 * download, no install — for an install something else owns, a Homebrew cask
 * most of all. Main reads it directly too, so a hand edit of `config.json`
 * reaches the updater without the renderer.
 */
export const automaticUpdatesAtom = settingAtom('general', 'automaticUpdates');
export const toolCallCollapseAtom = settingAtom('general', 'toolCallCollapse');

// ─── Models ───────────────────────────────────────────────────────────────────
export const defaultChatModelAtom = settingAtom('models', 'defaultModel');
export const defaultChatThinkingLevelAtom = settingAtom(
	'models',
	'defaultThinkingLevel',
);
export const reviewModelAtom = settingAtom('models', 'reviewModel');
export const reviewThinkingLevelAtom = settingAtom(
	'models',
	'reviewThinkingLevel',
);
export const hiddenModelsAtom = settingAtom('models', 'hiddenModels');

// ─── Providers ──────────────────────────────────────────────────────────────────
/**
 * Which delegation mechanism a Claude Code chat opens under: `ensemblr` spawns
 * sub-agents into their own chat tabs and denies Claude's built-in sub-agent
 * tool, `native` does the reverse. Read at session open, so a change reaches the
 * next chat rather than the one already running.
 */
export const claudeSubagentModeAtom = settingAtom(
	'providers',
	'claudeSubagentMode',
);

// ─── Git (user defaults) ────────────────────────────────────────────────────────
// Atom names stay friendly; the backing keys mirror the repo-resolution keys so
// the same values feed `resolveSettings` as the `user-default` source.
export const branchPrefixSourceAtom = settingAtom('git', 'branchPrefixSource');
export const branchPrefixCustomAtom = settingAtom('git', 'branchPrefixCustom');
export const renameWorkspaceOnBranchAtom = settingAtom(
	'git',
	'renameWorkspaceOnBranch',
);
export const deleteBranchOnArchiveAtom = settingAtom(
	'git',
	'deleteLocalBranchOnArchive',
);
export const archiveOnMergeAtom = settingAtom('git', 'archiveAfterMerge');
export const setUpstreamOnPushAtom = settingAtom('git', 'setUpstreamOnPush');

// ─── Experimental ────────────────────────────────────────────────────────────────
/**
 * Whether a repository's run script auto-starts after setup when no repository
 * override exists.
 */
export const autoRunAfterSetupAtom = settingAtom(
	'experimental',
	'autoRunAfterSetup',
);
/** Whether developer-only diagnostics and debug controls are visible. */
export const developerModeAtom = settingAtom('experimental', 'developerMode');

// ─── Appearance ─────────────────────────────────────────────────────────────────
// Backs the Settings → Appearance page. Consumers apply these live via
// `useThemeEffect`/`useAppearanceEffect` (DOM classes + CSS vars), the xterm
// adapter (terminal typography), and the Shiki/Streamdown code renderers.
export const themeAtom = settingAtom('appearance', 'theme');
export const accessibleColorsAtom = settingAtom(
	'appearance',
	'accessibleColors',
);
export const codeThemeAtom = settingAtom('appearance', 'codeTheme');
export const monoFontAtom = settingAtom('appearance', 'monoFont');
export const codeLigaturesAtom = settingAtom('appearance', 'codeLigatures');
export const markdownStyleAtom = settingAtom('appearance', 'markdownStyle');
export const terminalFontAtom = settingAtom('appearance', 'terminalFont');
export const terminalFontSizeAtom = settingAtom(
	'appearance',
	'terminalFontSize',
);
export const terminalScrollbackMbAtom = settingAtom(
	'appearance',
	'terminalScrollbackMb',
);

/** Whether the composer shows its dictation control. */
export const dictationEnabledAtom = settingAtom('dictation', 'enabled');
/** OpenAI-compatible API root the transcription request is posted to. */
export const dictationBaseUrlAtom = settingAtom('dictation', 'baseUrl');
/** Transcription model id sent with each clip. */
export const dictationModelAtom = settingAtom('dictation', 'model');

/**
 * Hydrates {@link appSettingsAtom} from `config.json` on mount and live-reloads
 * it when the file is edited outside the app. Mount once at the app root.
 */
export function useAppSettingsSync(): void {
	const setSettings = useSetAtom(appSettingsAtom);
	useEffect(() => {
		let active = true;
		void getAppSettings()
			.then((settings) => {
				if (active) {
					setSettings(settings);
				}
			})
			.catch(() => undefined);
		const unsubscribe = subscribeAppSettingsChanged((event) => {
			setSettings(event.settings);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [setSettings]);
}
