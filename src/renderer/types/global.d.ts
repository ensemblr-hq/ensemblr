import type { EnsemblrApi } from '@/shared/ipc/contracts/api';
import type { InitialShellSnapshot } from '@/shared/ipc/contracts/shell-snapshot';

declare global {
	interface Window {
		ensemblr?: EnsemblrApi;
		ensemblrInitialShellSnapshot?: InitialShellSnapshot;
	}
}
