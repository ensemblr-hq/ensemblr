/** Bytes in one megabyte, used to size the main-process pty scrollback buffer. */
const BYTES_PER_MB = 1024 * 1024;

/**
 * Estimated bytes per terminal line, used to convert the megabyte-based
 * scrollback setting into an xterm line count. xterm bounds scrollback by line
 * count while the main-process buffer bounds by bytes; a coarse estimate keeps
 * the two roughly proportional to the same user-facing megabyte value.
 */
const BYTES_PER_LINE_ESTIMATE = 128;

/**
 * Converts the `appearance.terminalScrollbackMb` setting into a byte limit for
 * the main-process pty scrollback buffer.
 * @param megabytes - Configured scrollback size in megabytes.
 * @returns The buffer byte limit (at least 1 MB).
 */
export function scrollbackMbToBytes(megabytes: number): number {
	return Math.max(1, Math.round(megabytes)) * BYTES_PER_MB;
}

/**
 * Converts the `appearance.terminalScrollbackMb` setting into an xterm
 * scrollback line count.
 * @param megabytes - Configured scrollback size in megabytes.
 * @returns The xterm scrollback line count (at least 1 MB worth of lines).
 */
export function scrollbackMbToLines(megabytes: number): number {
	return Math.floor(scrollbackMbToBytes(megabytes) / BYTES_PER_LINE_ESTIMATE);
}
