export const IPC_CHANNELS = {
	health: 'piductor:health',
} as const;

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

export interface HealthSnapshot {
	appName: string;
	config: ConfigStatusSnapshot;
	database: {
		error?: string;
		path: string;
		schemaVersion: number;
		status: 'ok' | 'error';
	};
	platform: string;
	status: 'ok';
	timestamp: string;
	versions: {
		chrome: string;
		electron: string;
		node: string;
	};
}

export interface PiductorApi {
	health: () => Promise<HealthSnapshot>;
}
