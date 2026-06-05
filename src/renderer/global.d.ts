import type { EnsembleApi } from '../shared/ipc';

declare global {
	interface Window {
		ensemble?: EnsembleApi;
	}
}
