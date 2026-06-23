/**
 * Public surface for the renderer-wide preferences concern: persisted user
 * preference atoms (theme, fonts, sounds, follow-up behavior, composer model
 * memory) plus the theme-application side-effect hook.
 *
 * Outside this folder, import from `@/renderer/state/preferences` only.
 */

// Config.json-backed App settings (General + Models sections). The source of
// truth is `~/.config/ensemble/config.json`; see ./app-settings.
export {
	alwaysShowContextUsageAtom,
	appSettingsAtom,
	archiveOnMergeAtom,
	autoConvertLongTextAtom,
	branchPrefixCustomAtom,
	branchPrefixSourceAtom,
	caffeinateWhileRunningAtom,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	deleteBranchOnArchiveAtom,
	desktopNotificationsAtom,
	followUpBehaviorAtom,
	hiddenModelsAtom,
	renameWorkspaceOnBranchAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
	sendShortcutAtom,
	setUpstreamOnPushAtom,
	toolCallCollapseAtom,
	useAppSettingsSync,
} from './app-settings';
export type {
	AccessibleColorVariant,
	CodeTheme,
	FollowUpBehavior,
	MarkdownStyle,
	PrDetailsDraft,
	PrDetailsLiveDraft,
	RepoActionKey,
	RepoSettingsKey,
	RepoSettingsOverride,
	SendShortcut,
	ThemeMode,
	ToolCallCollapseMode,
} from './atoms';
export {
	accessibleColorsAtom,
	autoRunAfterSetupAtom,
	chatModelOverrideAtomFamily,
	chatThinkingOverrideAtomFamily,
	codeLigaturesAtom,
	codeThemeAtom,
	coloredSidebarDiffsAtom,
	customPiExecutablePathAtom,
	favouriteModelsAtom,
	forgetChatOverrides,
	inAppBrowserPreviewAtom,
	markdownStyleAtom,
	monoFontAtom,
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
	REPO_ACTION_KEYS,
	repoSettingsOverrideAtomFamily,
	showDashboardAtom,
	showSidebarResourceUsageAtom,
	sidebarChatsModeAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	terminalScrollbackMbAtom,
	themeAtom,
} from './atoms';
export { useThemeEffect } from './use-theme-effect';
