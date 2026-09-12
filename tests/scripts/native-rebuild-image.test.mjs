import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SCRIPT = readFileSync(
	fileURLToPath(
		new URL('../../scripts/rebuild-native-linux.sh', import.meta.url),
	),
	'utf8',
);

/**
 * Reads the default value of the script's `IMAGE` variable.
 * @returns The image reference the container build falls back to.
 */
function defaultImage() {
	const match = SCRIPT.match(
		/^IMAGE=\$\{ENSEMBLR_NATIVE_REBUILD_IMAGE:-(.+)\}$/m,
	);
	return match?.[1] ?? '';
}

// The preflight shells out to this script unattended, with the worktree
// bind-mounted writable, and its output is the `pty.node` that ships inside the
// AppImage. A floating tag would make the release path depend on whatever that
// tag points at on the day.
describe('the Linux native-rebuild container image', () => {
	test('is pinned by digest, not by a floating tag', () => {
		expect(defaultImage()).toMatch(/^node:24-bookworm@sha256:[0-9a-f]{64}$/);
	});

	test('still bind-mounts only the repository root it was invoked from', () => {
		expect(SCRIPT).toContain('--volume "$repo_root":/src');
	});
});
