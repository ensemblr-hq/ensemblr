/** Validation status of the app config file. */
export type ConfigStatus = 'error' | 'invalid' | 'missing' | 'ok';
/** Severity level for a config diagnostic. */
export type ConfigDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A diagnostic about the app config file, optionally located at a line/column or field path. */
export interface ConfigDiagnostic {
	code: string;
	column?: number;
	fieldPath?: string;
	line?: number;
	message: string;
	severity: ConfigDiagnosticSeverity;
}

/** Snapshot of the app config's validation state, diagnostics, and load metadata. */
export interface ConfigStatusSnapshot {
	blocksReadiness: boolean;
	diagnostics: ConfigDiagnostic[];
	displayPath: string;
	loadedAt: string;
	path: string;
	schemaVersion: number | null;
	status: ConfigStatus;
}

/** Health status of the local database. */
export type DatabaseStatus = 'ok' | 'error';

/** Snapshot of the local database's health, path, and schema version. */
export interface DatabaseHealthSnapshot {
	error?: string;
	path: string;
	schemaVersion: number;
	status: DatabaseStatus;
}

/** Overall process and database health snapshot returned by the health IPC channel. */
export interface HealthSnapshot {
	appName: string;
	config: ConfigStatusSnapshot;
	database: DatabaseHealthSnapshot;
	platform: string;
	status: 'ok';
	timestamp: string;
	versions: {
		chrome: string;
		electron: string;
		node: string;
	};
}

/** Process / database health IPC surface. */
export interface HealthApi {
	health: () => Promise<HealthSnapshot>;
}
