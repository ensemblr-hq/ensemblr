import type { LocalCommandService } from '../commands/local-command';

/**
 * `du` walks the whole tree, which for a dependency-heavy worktree is tens of
 * thousands of inodes. Generous enough that a cold file cache still finishes,
 * short enough that a wedged filesystem does not hold a removal open.
 */
const DISK_USAGE_TIMEOUT_MS = 60_000;

/**
 * Measures a directory with `du -sk` so a caller can report bytes reclaimed.
 *
 * Best-effort by design: an unavailable or slow `du` reports null and the caller
 * says nothing about size, which is never a reason to skip the removal the
 * measurement precedes.
 * @param options - Directory to measure and the command runner.
 * @returns Size in bytes, or null when the measurement did not complete.
 */
export async function measureDirectoryBytes({
	directoryPath,
	localCommandService,
}: {
	directoryPath: string;
	localCommandService: LocalCommandService;
}): Promise<number | null> {
	try {
		const result = await localCommandService.run({
			args: ['-sk', directoryPath],
			command: 'du',
			cwd: directoryPath,
			maxOutputBytes: 4 * 1024,
			timeoutMs: DISK_USAGE_TIMEOUT_MS,
		});
		if (result.status !== 'success') {
			return null;
		}
		const kilobytes = Number.parseInt(result.stdout.trim().split(/\s+/)[0], 10);
		return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
	} catch {
		return null;
	}
}
