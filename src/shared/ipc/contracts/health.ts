import type { ConfigStatusSnapshot } from './config';

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
