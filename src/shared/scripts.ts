/**
 * Public entrypoint for workspace script settings and persisted setup state.
 * Import from here rather than the `scripts/` implementation files.
 */
export type {
	RunScriptDefinition,
	RunScriptIconName,
	RunScriptIssue,
} from './scripts/run-scripts.ts';
export {
	DEFAULT_RUN_SCRIPT_ICON,
	formatRunScriptLabel,
	isRunScriptAvailableLocally,
	isRunScriptIconName,
	LEGACY_RUN_SCRIPT_NAME,
	LOCAL_RUN_ENVIRONMENT,
	normalizeRunScripts,
	normalizeRunScriptTable,
	RUN_SCRIPT_ICON_NAMES,
	resolveRunScript,
	selectAvailableRunScripts,
	selectDefaultRunScript,
} from './scripts/run-scripts.ts';
export type {
	ResolvedScriptSettingEntry,
	RunScriptMode,
	SingleCommandScriptKind,
	WorkspaceScriptSettings,
} from './scripts/script-settings.ts';
export {
	parseWorkspaceScriptSettings,
	readConfiguredRunScripts,
} from './scripts/script-settings.ts';
export type { WorkspaceSetupState } from './scripts/setup-state.ts';
export { parseSetupState } from './scripts/setup-state.ts';
