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
	autoConvertLongTextAtom,
	caffeinateWhileRunningAtom,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	desktopNotificationsAtom,
	followUpBehaviorAtom,
	hiddenModelsAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
	sendShortcutAtom,
	toolCallCollapseAtom,
	useAppSettingsSync,
} from './app-settings';
export type {
	AccessibleColorVariant,
	BranchPrefixSource,
	CodeTheme,
	FollowUpBehavior,
	MarkdownStyle,
	RepoActionKey,
	RepoSettingsKey,
	RepoSettingsOverride,
	SendShortcut,
	ThemeMode,
	ToolCallCollapseMode,
} from './atoms';
export {
	accessibleColorsAtom,
	archiveOnMergeAtom,
	autoRunAfterSetupAtom,
	branchPrefixCustomAtom,
	branchPrefixSourceAtom,
	chatModelOverrideAtomFamily,
	chatThinkingOverrideAtomFamily,
	codeLigaturesAtom,
	codeThemeAtom,
	coloredSidebarDiffsAtom,
	customPiExecutablePathAtom,
	deleteBranchOnArchiveAtom,
	favouriteModelsAtom,
	forgetChatOverrides,
	inAppBrowserPreviewAtom,
	markdownStyleAtom,
	monoFontAtom,
	REPO_ACTION_KEYS,
	renameWorkspaceOnBranchAtom,
	repoSettingsOverrideAtomFamily,
	setUpstreamOnPushAtom,
	showDashboardAtom,
	showSidebarResourceUsageAtom,
	sidebarChatsModeAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	terminalScrollbackMbAtom,
	themeAtom,
} from './atoms';
export { useThemeEffect } from './use-theme-effect';
