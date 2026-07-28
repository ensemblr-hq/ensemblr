/**
 * Public entrypoint for workspace script settings and persisted setup state.
 * Import from here rather than the `scripts/` implementation files.
 */
export type {
	ResolvedScriptSettingEntry,
	RunScriptMode,
	WorkspaceScriptSettings,
} from './scripts/script-settings.ts';
export { parseWorkspaceScriptSettings } from './scripts/script-settings.ts';
export type { WorkspaceSetupState } from './scripts/setup-state.ts';
export { parseSetupState } from './scripts/setup-state.ts';
