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
	developerModeAtom,
	followUpBehaviorAtom,
	hiddenModelsAtom,
	languageAtom,
	markdownStyleAtom,
	monoFontAtom,
	renameWorkspaceOnBranchAtom,
	reviewModelAtom,
	reviewThinkingLevelAtom,
	sendShortcutAtom,
	setUpstreamOnPushAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	terminalScrollbackMbAtom,
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
	lastRunScriptAtomFamily,
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
	REPO_ACTION_KEYS,
	repoSettingsOverrideAtomFamily,
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
