export type ConfigStatus = 'error' | 'invalid' | 'missing' | 'ok';
export type ConfigDiagnosticSeverity = 'error' | 'info' | 'warning';

export interface ConfigDiagnostic {
	code: string;
	column?: number;
	fieldPath?: string;
	line?: number;
	message: string;
	severity: ConfigDiagnosticSeverity;
}

export interface ConfigStatusSnapshot {
	blocksReadiness: boolean;
	diagnostics: ConfigDiagnostic[];
	displayPath: string;
	loadedAt: string;
	path: string;
	schemaVersion: number | null;
	status: ConfigStatus;
}
