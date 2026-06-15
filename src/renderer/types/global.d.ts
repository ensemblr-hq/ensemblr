import type { EnsembleApi } from '@/shared/ipc/contracts/api';
import type { InitialShellSnapshot } from '@/shared/ipc/contracts/shell-snapshot';

declare global {
	interface Window {
		ensemble?: EnsembleApi;
		ensembleInitialShellSnapshot?: InitialShellSnapshot;
	}
}
