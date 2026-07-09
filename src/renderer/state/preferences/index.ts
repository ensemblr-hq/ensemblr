/**
 * Public surface for the renderer-wide preferences concern: persisted user
 * preference atoms (theme, fonts, sounds, follow-up behavior, composer model
 * memory) plus the theme-application side-effect hook.
 *
 * Outside this folder, import from `@/renderer/state/preferences` only.
 */

// Config.json-backed App settings (General, Models, Git, Appearance sections).
// The source of truth is `~/.config/ensemble/config.json`; see ./app-settings.
export {
	accessibleColorsAtom,
	alwaysShowContextUsageAtom,
	appSettingsAtom,
	archiveOnMergeAtom,
	autoConvertLongTextAtom,
	branchPrefixCustomAtom,
	branchPrefixSourceAtom,
	caffeinateWhileRunningAtom,
	codeLigaturesAtom,
	codeThemeAtom,
	coloredSidebarDiffsAtom,
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
	autoRunAfterSetupAtom,
	chatModelOverrideAtomFamily,
	chatThinkingOverrideAtomFamily,
	customPiExecutablePathAtom,
	favouriteModelsAtom,
	forgetChatOverrides,
	inAppBrowserPreviewAtom,
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
	REPO_ACTION_KEYS,
	repoSettingsOverrideAtomFamily,
	showDashboardAtom,
	showSidebarResourceUsageAtom,
	sidebarChatsModeAtom,
	terminalScrollbackMbAtom,
} from './atoms';
export { useAppearanceEffect } from './use-appearance-effect';
export { useAppearanceLegacyMigration } from './use-appearance-migration';
export { useThemeEffect } from './use-theme-effect';
