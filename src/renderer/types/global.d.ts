import type { EnsembleApi, InitialShellSnapshot } from '@/shared/ipc';

declare global {
	interface Window {
		ensemble?: EnsembleApi;
		ensembleInitialShellSnapshot?: InitialShellSnapshot;
	}
}
