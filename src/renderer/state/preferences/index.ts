/**
 * Public surface for the renderer-wide preferences concern: persisted user
 * preference atoms (theme, fonts, sounds, follow-up behavior, composer model
 * memory) plus the theme-application side-effect hook.
 *
 * Outside this folder, import from `@/renderer/state/preferences` only.
 */

// Config.json-backed App settings (General, Models, Git, Appearance,
// Experimental sections).
// The source of truth is `~/.config/ensemblr/config.json`; see ./app-settings.
export {
	accessibleColorsAtom,
	alwaysShowContextUsageAtom,
	appSettingsAtom,
	archiveOnMergeAtom,
	autoConvertLongTextAtom,
	autoRunAfterSetupAtom,
	branchPrefixCustomAtom,
	branchPrefixSourceAtom,
	caffeinateWhileRunningAtom,
	codeLigaturesAtom,
	codeThemeAtom,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	deleteBranchOnArchiveAtom,
	desktopNotificationsAtom,
	followUpBehaviorAtom,
	hiddenModelsAtom,
	markdownStyleAtom,
	monoFontAtom,
	renameWorkspaceOnBranchAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
	sendShortcutAtom,
	setUpstreamOnPushAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	themeAtom,
	toolCallCollapseAtom,
	useAppSettingsSync,
} from './app-settings';
export type {
	FollowUpBehavior,
	PrDetailsDraft,
	PrDetailsLiveDraft,
	RepoActionKey,
	RepoSettingsKey,
	RepoSettingsOverride,
	SendShortcut,
	ToolCallCollapseMode,
} from './atoms';
export {
	chatModelOverrideAtomFamily,
	chatThinkingOverrideAtomFamily,
	customPiExecutablePathAtom,
	developerModeAtom,
	favouriteModelsAtom,
	forgetChatOverrides,
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
	REPO_ACTION_KEYS,
	repoSettingsOverrideAtomFamily,
	terminalScrollbackMbAtom,
} from './atoms';
export { useAppearanceEffect } from './use-appearance-effect';
export { useThemeEffect } from './use-theme-effect';
