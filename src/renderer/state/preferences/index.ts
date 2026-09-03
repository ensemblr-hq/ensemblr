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
	automaticUpdatesAtom,
	autoRunAfterSetupAtom,
	branchPrefixCustomAtom,
	branchPrefixSourceAtom,
	caffeinateWhileRunningAtom,
	claudeSubagentModeAtom,
	codeLigaturesAtom,
	codeThemeAtom,
	conciergeAutoClearAtPercentAtom,
	conciergeModelAtom,
	conciergeProviderAtom,
	conciergeThinkingLevelAtom,
	defaultChatModelAtom,
	defaultChatThinkingLevelAtom,
	deleteBranchOnArchiveAtom,
	desktopNotificationsAtom,
	developerModeAtom,
	dictationBaseUrlAtom,
	dictationEnabledAtom,
	dictationModelAtom,
	followUpBehaviorAtom,
	hiddenModelsAtom,
	languageAtom,
	markdownStyleAtom,
	monoFontAtom,
	notificationSoundAtom,
	renameWorkspaceOnBranchAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
	sendShortcutAtom,
	setUpstreamOnPushAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	terminalScrollbackMbAtom,
	themeAtom,
	titleBarAtom,
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
	chatAppliedLinkedDirectoriesAtomFamily,
	chatLinkedDirectoriesAtomFamily,
	chatModelOverrideAtomFamily,
	chatPlanModeAtomFamily,
	chatThinkingOverrideAtomFamily,
	diffLayoutAtom,
	diffShowWhitespaceAtom,
	diffWordWrapAtom,
	favouriteModelsAtom,
	filePreviewMarkdownPreviewAtom,
	filePreviewWordWrapAtom,
	forgetChatOverrides,
	forgetLastRunScript,
	lastQuickStartOwnerAtom,
	lastRunScriptAtomFamily,
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
	REPO_ACTION_KEYS,
	repoSettingsOverrideAtomFamily,
	retainLastRunScripts,
} from './atoms';
export { useAppearanceEffect } from './use-appearance-effect';
export {
	CODE_THEME_FAMILIES,
	codeThemeFamilyId,
	codeThemeForMode,
	useResolvedCodeTheme,
} from './use-code-theme';
export { useLanguageEffect } from './use-language-effect';
export { useThemeEffect } from './use-theme-effect';
