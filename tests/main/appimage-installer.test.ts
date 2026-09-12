import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createAppImageInstaller } from '../../src/main/updates/appimage-installer';
import type { UpdaterEventHandlers } from '../../src/main/updates/update-service';
import type { UpdateFailureCode } from '../../src/shared/ipc/contracts/update';

const APPIMAGE_NAME = 'Ensemblr-0.1.5-x64.AppImage';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'ensemblr-appimage-'));
});

afterEach(() => {
	rmSync(root, { force: true, recursive: true });
});

/** Digest of a body in the `sha256:<hex>` form GitHub publishes. */
function digestOf(body: string): string {
	return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

/** A fetch that answers every request with one body. */
function servingFetch(body: string, status = 200): typeof fetch {
	return (async () =>
		new Response(status === 200 ? body : null, { status })) as typeof fetch;
}

/** Collects what the installer reports, so a test can await the outcome. */
function recorder() {
	const errors: { code: UpdateFailureCode | undefined; error: Error }[] = [];
	let downloaded = 0;
	let settle: () => void = () => {};
	const settled = new Promise<void>((resolve) => {
		settle = resolve;
	});
	const handlers: UpdaterEventHandlers = {
		onDownloaded: () => {
			downloaded += 1;
			settle();
		},
		onError: (error, code) => {
			errors.push({ code, error });
			settle();
		},
		onNotAvailable: () => {},
	};
	return {
		downloaded: () => downloaded,
		errors,
		handlers,
		settled,
	};
}

/**
 * Builds an installer over a temp directory holding a stand-in AppImage,
 * defaulting the XDG root to a sibling with no manifest in it.
 */
function harness(
	options: {
		appImageDirectory?: string;
		body?: string;
		fetchImpl?: typeof fetch;
	} = {},
) {
	const appImageDirectory = options.appImageDirectory ?? join(root, 'apps');
	mkdirSync(appImageDirectory, { recursive: true });
	const appImagePath = join(appImageDirectory, APPIMAGE_NAME);
	writeFileSync(appImagePath, 'the running build');
	const body = options.body ?? 'the new build';
	const events = recorder();
	const installer = createAppImageInstaller({
		appImagePath,
		env: { XDG_DATA_HOME: join(root, 'xdg') },
		fetchImpl: options.fetchImpl ?? servingFetch(body),
		homeDirectory: join(root, 'home'),
	});
	installer.on(events.handlers);
	return { appImagePath, body, events, installer };
}

describe('createAppImageInstaller', () => {
	test('stages a download whose digest matches, leaving the running file alone', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		expect(h.events.errors).toEqual([]);
		expect(h.events.downloaded()).toBe(1);
		expect(readFileSync(h.appImagePath, 'utf8')).toBe('the running build');
	});

	test('applying the staged download replaces the running file', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		expect(h.installer.applyStaged()).toBe(true);
		expect(readFileSync(h.appImagePath, 'utf8')).toBe('the new build');
	});

	test('the swapped-in AppImage stays executable', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;
		h.installer.applyStaged();

		expect(statSync(h.appImagePath).mode & 0o111).not.toBe(0);
	});

	test('a digest mismatch is reported as a verification failure and staged nothing', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf('a different build'), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		expect(h.events.errors[0]?.code).toBe(
			'update-verification-failed' satisfies UpdateFailureCode,
		);
		expect(h.installer.applyStaged()).toBe(false);
		expect(readFileSync(h.appImagePath, 'utf8')).toBe('the running build');
	});

	test('a mismatched download leaves no partial file behind', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf('a different build'), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		const staging = join(
			root,
			'apps',
			`.${APPIMAGE_NAME}.ensemblr-update.part`,
		);
		expect(existsSync(staging)).toBe(false);
	});

	test('a failed download reports without a specific code', async () => {
		const events = recorder();
		const appImagePath = join(root, APPIMAGE_NAME);
		writeFileSync(appImagePath, 'the running build');
		const installer = createAppImageInstaller({
			appImagePath,
			env: {},
			fetchImpl: servingFetch('', 404),
			homeDirectory: root,
		});
		installer.on(events.handlers);
		installer.arm(
			{ digest: digestOf('x'), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await events.settled;

		expect(events.errors[0]?.code).toBeUndefined();
		expect(events.errors[0]?.error.message).toContain('404');
	});

	test('the download is bounded by an abort signal', async () => {
		let signal: AbortSignal | null = null;
		const h = harness({
			fetchImpl: (async (_url: string, init?: RequestInit) => {
				signal = init?.signal ?? null;
				return new Response('the new build');
			}) as unknown as typeof fetch,
		});

		h.installer.arm(
			{ digest: digestOf('the new build'), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		expect(signal).toBeInstanceOf(AbortSignal);
	});

	test('a download that aborts reports an error and stages nothing', async () => {
		const h = harness({
			fetchImpl: (async () => {
				throw new DOMException('The operation timed out.', 'TimeoutError');
			}) as unknown as typeof fetch,
		});

		h.installer.arm(
			{ digest: digestOf('the new build'), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		expect(h.events.errors[0]?.code).toBeUndefined();
		expect(h.events.errors[0]?.error.message).toContain('timed out');
		expect(h.installer.applyStaged()).toBe(false);
	});

	test('applyStaged reports false when nothing was staged', () => {
		const h = harness();
		expect(h.installer.applyStaged()).toBe(false);
	});

	test('applyStaged refuses a staged file tampered with after download', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		const stagingPath = join(root, 'apps', `.${APPIMAGE_NAME}.ensemblr-update`);
		writeFileSync(stagingPath, 'tampered after verification');

		expect(h.installer.applyStaged()).toBe(false);
		expect(existsSync(stagingPath)).toBe(false);
		expect(readFileSync(h.appImagePath, 'utf8')).toBe('the running build');
		expect(h.events.errors.at(-1)?.code).toBe(
			'update-verification-failed' satisfies UpdateFailureCode,
		);
	});

	test('discardStaged drops a staged download so it can never be applied', async () => {
		const h = harness();
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;

		h.installer.discardStaged();

		expect(h.installer.applyStaged()).toBe(false);
		expect(readFileSync(h.appImagePath, 'utf8')).toBe('the running build');
	});
});

describe('the install.sh manifest', () => {
	/** Writes the manifest install.sh keeps, in the directory it installs into. */
	function seedManifest(contents: string): string {
		const directory = join(root, 'xdg', 'ensemblr');
		mkdirSync(directory, { recursive: true });
		const path = join(directory, '.version');
		writeFileSync(path, contents);
		return path;
	}

	test('is rewritten in the format it already carried, keeping the v prefix', async () => {
		const manifest = seedManifest('v0.1.5\n');
		const h = harness({ appImageDirectory: join(root, 'xdg', 'ensemblr') });
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;
		h.installer.applyStaged();

		expect(readFileSync(manifest, 'utf8')).toBe('v0.2.0\n');
	});

	test('keeps a bare version bare, and a missing newline missing', async () => {
		const manifest = seedManifest('0.1.5');
		const h = harness({ appImageDirectory: join(root, 'xdg', 'ensemblr') });
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;
		h.installer.applyStaged();

		expect(readFileSync(manifest, 'utf8')).toBe('0.2.0');
	});

	test('is never created for an AppImage install.sh does not manage', async () => {
		const h = harness({ appImageDirectory: join(root, 'apps') });
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;
		h.installer.applyStaged();

		expect(existsSync(join(root, 'xdg', 'ensemblr', '.version'))).toBe(false);
	});

	test('is left alone when the running AppImage lives somewhere else', async () => {
		const manifest = seedManifest('v0.1.5\n');
		const h = harness({ appImageDirectory: join(root, 'elsewhere') });
		h.installer.arm(
			{ digest: digestOf(h.body), url: 'https://x.invalid/a' },
			'0.2.0',
		);
		await h.events.settled;
		h.installer.applyStaged();

		expect(readFileSync(manifest, 'utf8')).toBe('v0.1.5\n');
	});
});
