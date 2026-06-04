export const IPC_CHANNELS = {
	health: 'piductor:health',
} as const;

export interface HealthSnapshot {
	appName: string;
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
