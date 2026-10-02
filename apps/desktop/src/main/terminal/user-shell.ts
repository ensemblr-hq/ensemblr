import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';

const FALLBACK_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh'] as const;

/**
 * Resolves the user's login shell for interactive terminals (fish, zsh, …).
 *
 * `os.userInfo().shell` reads the passwd database, which works even when the
 * app was launched from Finder/Dock and inherited no `SHELL` variable.
 * `process.env.SHELL` is the dev-launch fallback; system shells close the
 * chain so a stale passwd entry never yields a dead path.
 * @returns Absolute path of an existing shell binary.
 */
export function resolveUserShell(): string {
	const candidates = [safeUserInfoShell(), process.env.SHELL];

	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) {
			return candidate;
		}
	}

	for (const fallback of FALLBACK_SHELLS) {
		if (existsSync(fallback)) {
			return fallback;
		}
	}

	return '/bin/sh';
}

/**
 * Resolves a POSIX-compatible shell for script commands. Skips the user's
 * login shell on purpose: repository scripts routinely use `VAR=x cmd` and
 * other constructs that fish rejects.
 * @returns Absolute path of an existing POSIX shell binary.
 */
export function resolveScriptShell(): string {
	for (const fallback of FALLBACK_SHELLS) {
		if (existsSync(fallback)) {
			return fallback;
		}
	}

	return '/bin/sh';
}

/** `os.userInfo()` can throw on exotic systems; treat that as "unknown". */
function safeUserInfoShell(): string | null {
	try {
		return userInfo().shell ?? null;
	} catch {
		return null;
	}
}
