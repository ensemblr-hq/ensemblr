import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { findHomebrewCask } from '@/main/updates/homebrew-cask';

const createdRoots: string[] = [];

/** Creates a throwaway root directory that is removed after the test. */
function createRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemblr-homebrew-cask-'));
	createdRoots.push(root);
	return root;
}

/** Lays out an installed `.app` bundle directory under a fake Applications folder. */
function installBundle(root: string, name = 'Ensemblr.app'): string {
	const bundle = path.join(root, 'Applications', name);
	mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
	return bundle;
}

/** Writes the link Homebrew leaves in its Caskroom for an app it moved into place. */
function linkCask(
	caskroom: string,
	token: string,
	version: string,
	bundle: string,
): void {
	const versionDirectory = path.join(caskroom, token, version);
	mkdirSync(versionDirectory, { recursive: true });
	symlinkSync(bundle, path.join(versionDirectory, path.basename(bundle)));
}

afterEach(() => {
	for (const root of createdRoots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
});

describe('findHomebrewCask', () => {
	test('names the cask whose Caskroom link resolves to the bundle', () => {
		const root = createRoot();
		const bundle = installBundle(root);
		const caskroom = path.join(root, 'Caskroom');
		linkCask(caskroom, 'ensemblr', '0.1.20', bundle);
		mkdirSync(path.join(caskroom, 'ensemblr', '.metadata'), {
			recursive: true,
		});

		expect(findHomebrewCask(bundle, [caskroom])).toBe('ensemblr');
	});

	test('matches by link target, so a renamed cask still counts', () => {
		const root = createRoot();
		const bundle = installBundle(root);
		const caskroom = path.join(root, 'Caskroom');
		linkCask(caskroom, 'ensemblr-fork', '0.1.20', bundle);

		expect(findHomebrewCask(bundle, [caskroom])).toBe('ensemblr-fork');
	});

	test('ignores a cask whose app of the same name lives elsewhere', () => {
		const root = createRoot();
		const bundle = installBundle(root);
		const elsewhere = installBundle(path.join(root, 'other'));
		const caskroom = path.join(root, 'Caskroom');
		linkCask(caskroom, 'ensemblr', '0.1.20', elsewhere);

		expect(findHomebrewCask(bundle, [caskroom])).toBeNull();
	});

	test('searches the Intel prefix when the Apple-silicon one has no link', () => {
		const root = createRoot();
		const bundle = installBundle(root);
		const appleSilicon = path.join(root, 'opt-homebrew', 'Caskroom');
		const intel = path.join(root, 'usr-local', 'Caskroom');
		mkdirSync(appleSilicon, { recursive: true });
		linkCask(intel, 'ensemblr', '0.1.19', bundle);

		expect(findHomebrewCask(bundle, [appleSilicon, intel])).toBe('ensemblr');
	});

	test('treats a Mac without Homebrew as owning nothing', () => {
		const root = createRoot();
		const bundle = installBundle(root);

		expect(
			findHomebrewCask(bundle, [path.join(root, 'no-such-caskroom')]),
		).toBeNull();
	});

	test('ignores a dangling link left behind by an uninstall', () => {
		const root = createRoot();
		const bundle = installBundle(root);
		const caskroom = path.join(root, 'Caskroom');
		linkCask(
			caskroom,
			'ensemblr',
			'0.1.18',
			path.join(root, 'gone', 'Ensemblr.app'),
		);

		expect(findHomebrewCask(bundle, [caskroom])).toBeNull();
	});

	test('reports nothing for a bundle path that does not exist', () => {
		const root = createRoot();
		const caskroom = path.join(root, 'Caskroom');
		mkdirSync(caskroom, { recursive: true });

		expect(
			findHomebrewCask(path.join(root, 'Applications', 'Ensemblr.app'), [
				caskroom,
			]),
		).toBeNull();
	});
});
