import {
	enabled,
	getActiveNavigation,
	type IpcProfileMetadata,
	now,
} from './profiler-store';

/**
 * Wraps an IPC invoke call, recording its duration on the active navigation
 * profile so the post-navigation log includes per-channel timings.
 * @param metadata - IPC call context.
 * @param call - The actual `ipcRenderer.invoke` call.
 * @returns The IPC response.
 */
export async function profileElectronIpcCall<T>(
	metadata: IpcProfileMetadata,
	call: () => Promise<T>,
): Promise<T> {
	if (!enabled) {
		return call();
	}

	const startedAt = now();

	try {
		return await call();
	} finally {
		getActiveNavigation()?.ipcRecords.push({
			...metadata,
			durationMs: now() - startedAt,
			startedAt,
		});
	}
}
