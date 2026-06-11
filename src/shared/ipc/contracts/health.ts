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

export type DatabaseStatus = 'ok' | 'error';

export interface DatabaseHealthSnapshot {
	error?: string;
	path: string;
	schemaVersion: number;
	status: DatabaseStatus;
}

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
