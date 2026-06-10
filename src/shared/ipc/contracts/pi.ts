export interface PiExecutableSelectionResult {
	canceled: boolean;
	error?: string;
	selectedPath?: string;
}

/** Source category for a slash command that Pi can accept through prompt input. */
export type PiSlashCommandSource = 'builtin' | 'extension' | 'prompt' | 'skill';

/** Scope of the Pi resource that registered a slash command. */
export type PiSlashCommandSourceScope = 'project' | 'temporary' | 'user';

/** IPC-safe slash command metadata shown in the composer autocomplete menu. */
export interface PiSlashCommandWire {
	autoSubmit: boolean;
	command: string;
	description: string;
	source: PiSlashCommandSource;
	sourceScope?: PiSlashCommandSourceScope;
}

/** Request for resolving Pi slash commands within a workspace directory. */
export interface ListPiSlashCommandsRequest {
	cwd?: string;
}

/** Response containing live Pi slash commands or static fallback commands. */
export interface ListPiSlashCommandsResult {
	commands: readonly PiSlashCommandWire[];
	error: string | null;
	source: 'sdk' | 'static';
}

/** Pi runtime / executable IPC surface (locate the Pi binary, etc). */
export interface PiApi {
	listPiSlashCommands: (
		request?: ListPiSlashCommandsRequest,
	) => Promise<ListPiSlashCommandsResult>;
	selectPiExecutable: () => Promise<PiExecutableSelectionResult>;
}
