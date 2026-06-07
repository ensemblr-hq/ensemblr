import type { SetupDiagnosticsSnapshot } from '@/shared/ipc';

export interface SetupDiagnosticsContextValue {
	state: {
		setupDiagnostics: SetupDiagnosticsSnapshot | null;
		setupDiagnosticsError: string | null;
		isSetupDiagnosticsRetrying: boolean;
	};
	actions: {
		onSetupDiagnosticsRetry: () => void;
	};
}
