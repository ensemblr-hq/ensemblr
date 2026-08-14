/**
 * Runtime-value barrel for the terminal helper concern. `xterm-adapter` is
 * deliberately absent: it imports `@xterm/xterm` and its stylesheet for side
 * effects, so re-exporting it here would pull the terminal renderer into every
 * consumer of this barrel. Import it directly from
 * `@/renderer/lib/terminal/xterm-adapter`.
 */
export {
	buildWorkspaceScriptSummaries,
	scriptSummaryToDockStatus,
	selectActiveRunScript,
} from './script-summaries';
export {
	emitTerminalInput,
	mapTerminalSessionsToDockTabs,
	reduceTerminalInputActivity,
	subscribeTerminalInput,
	terminalSessionToDockStatus,
	upsertTerminalSession,
} from './terminal-tabs';
