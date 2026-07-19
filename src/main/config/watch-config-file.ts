import { type FSWatcher, watch } from 'node:fs';
import path from 'node:path';

/**
 * Watches a single config file for changes and invokes `onChange` after a
 * debounce. Watches the containing directory (not the file) so editors that save
 * via rename-replace don't orphan the watcher, and filters events to the target
 * filename. Returned handle stops the watcher and clears any pending debounce.
 * @param options - The file to watch, debounce window, and change callback.
 * @returns A handle exposing `stop()`.
 */
export function watchConfigFile({
	debounceMs,
	filePath,
	onChange,
}: {
	debounceMs: number;
	filePath: string;
	onChange: () => void;
}): { stop: () => void } {
	const fileName = path.basename(filePath);
	let debounce: ReturnType<typeof setTimeout> | null = null;

	const watcher: FSWatcher = watch(
		path.dirname(filePath),
		(_event, changed) => {
			if (changed && changed !== fileName) {
				return;
			}
			if (debounce) {
				clearTimeout(debounce);
			}
			debounce = setTimeout(() => {
				debounce = null;
				onChange();
			}, debounceMs);
		},
	);

	return {
		stop: () => {
			if (debounce) {
				clearTimeout(debounce);
				debounce = null;
			}
			watcher.close();
		},
	};
}
