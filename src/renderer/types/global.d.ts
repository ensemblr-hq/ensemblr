import type { EnsembleApi } from '@/shared/ipc/contracts/api';
import type { InitialShellSnapshot } from '@/shared/ipc/contracts/repository-navigation';

declare global {
	interface Window {
		ensemble?: EnsembleApi;
		ensembleInitialShellSnapshot?: InitialShellSnapshot;
	}
}
