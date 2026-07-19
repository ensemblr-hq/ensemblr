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
 * Smallest scrollback size (in megabytes) the buffer is allowed to use. Also
 * serves as the fallback for non-finite input read from config.
 */
const MIN_SCROLLBACK_MB = 1;

/**
 * Coerces a raw megabyte value from config into a finite number, falling back to
 * the minimum when the input is NaN or Infinity. Negative and zero values are
 * left for the caller's lower-bound clamp.
 * @param megabytes - Raw scrollback size read from config.
 * @returns A finite megabyte value safe to pass to `Math.round`/`Math.max`.
 */
function sanitizeScrollbackMb(megabytes: number): number {
	return Number.isFinite(megabytes) ? megabytes : MIN_SCROLLBACK_MB;
}

/**
 * Converts the `appearance.terminalScrollbackMb` setting into a byte limit for
 * the main-process pty scrollback buffer.
 * @param megabytes - Configured scrollback size in megabytes.
 * @returns The buffer byte limit (at least 1 MB).
 */
export function scrollbackMbToBytes(megabytes: number): number {
	const sanitized = sanitizeScrollbackMb(megabytes);
	return Math.max(MIN_SCROLLBACK_MB, Math.round(sanitized)) * BYTES_PER_MB;
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
