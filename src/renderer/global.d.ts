import type { PiductorApi } from '../shared/ipc';

declare global {
	interface Window {
		piductor: PiductorApi;
	}
}
