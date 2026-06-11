/**
 * Public surface for the renderer-wide preferences concern: persisted user
 * preference atoms (theme, fonts, sounds, follow-up behavior, composer model
 * memory) plus the theme-application side-effect hook.
 *
 * Outside this folder, import from `@/renderer/state/preferences` only.
 */
export type {
	AccessibleColorVariant,
	CodeTheme,
	CompletionSound,
	FollowUpBehavior,
	MarkdownStyle,
	SendShortcut,
	ThemeMode,
	ToolCallCollapseMode,
} from './atoms';
export {
	accessibleColorsAtom,
	alwaysShowContextUsageAtom,
	autoConvertLongTextAtom,
	caffeinateWhileRunningAtom,
	codeLigaturesAtom,
	codeThemeAtom,
	coloredSidebarDiffsAtom,
	completionSoundAtom,
	desktopNotificationsAtom,
	followUpBehaviorAtom,
	lastSelectedPiModelAtom,
	lastSelectedPiThinkingLevelAtom,
	markdownStyleAtom,
	monoFontAtom,
	sendShortcutAtom,
	settingsActiveRepoIdAtom,
	showMcpStatusInChatAtom,
	softenCertaintyAtom,
	terminalFontAtom,
	terminalFontSizeAtom,
	themeAtom,
	toolCallCollapseAtom,
} from './atoms';
export { useThemeEffect } from './use-theme-effect';
