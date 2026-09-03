import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { author, homepage, version } from '../../package.json';
import { CREDITS_PACKAGES } from '../../src/main/menu/credits-manifest.gen';

const REAL_PLATFORM = process.platform;
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const appStub = vi.hoisted(() => ({
	getAppPath: vi.fn(() => ''),
	getVersion: vi.fn(() => ''),
	isPackaged: false,
	name: 'Ensemblr',
	setDesktopName: vi.fn(),
}));

vi.mock('electron', () => ({
	BrowserWindow: class {},
	app: appStub,
	screen: {},
}));

const { aboutPanelOptions } = await import(
	'../../src/main/menu/about-panel.ts'
);

/**
 * Overrides the reported platform for one test, so the Linux-only icon lookup
 * can be exercised from a macOS or CI host.
 * @param platform - Platform value `process.platform` should report.
 */
function pretendPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', {
		configurable: true,
		value: platform,
	});
}

beforeEach(() => {
	vi.stubGlobal('__ENSEMBLR_BUILD_CHANNEL__', 'release');
	appStub.isPackaged = false;
	appStub.getAppPath.mockReturnValue(REPO_ROOT);
	appStub.getVersion.mockReturnValue(version);
});

afterEach(() => {
	Object.defineProperty(process, 'platform', {
		configurable: true,
		value: REAL_PLATFORM,
	});
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

// GTK's about dialog reads nothing on its own: with no `applicationName` it
// falls back to the executable's file name, which under an AppImage is
// `Ensemblr-0.1.0-beta.18-x64.AppImage`.
test('names the app and its version rather than leaving GTK to guess', () => {
	pretendPlatform('linux');

	const options = aboutPanelOptions('en');

	expect(options.applicationName).toBe('Ensemblr');
	expect(options.applicationVersion).toBe(version);
	expect(options.copyright).toContain(author.name);
	expect(options.website).toBe(homepage);
});

// Without an explicit path GTK looks the icon up in the desktop's theme, which
// an unintegrated AppImage never installed — so the panel draws a broken image.
test('points the panel at a real icon file on Linux', () => {
	pretendPlatform('linux');

	const options = aboutPanelOptions('en');

	expect(options.iconPath).toBe(
		path.join(REPO_ROOT, 'assets', 'icons', 'icon-512.png'),
	);
});

// macOS reads the icon off the bundle; a path key it ignores is noise the
// support bundle would have to explain.
test('omits the icon path off Linux, where the platform owns it', () => {
	pretendPlatform('darwin');

	expect(aboutPanelOptions('en').iconPath).toBeUndefined();
});

// Electron splits the credits by platform — `authors` reaches only GTK's
// credits page and `credits` only the macOS panel — so a field left unset is a
// platform with no attribution at all.
test('credits every direct dependency on both platforms', () => {
	const options = aboutPanelOptions('en');
	const authors = options.authors ?? [];

	for (const entry of CREDITS_PACKAGES) {
		expect(authors).toContain(
			`${entry.name} — ${entry.license} <${entry.url}>`,
		);
		expect(options.credits).toContain(`${entry.name} — ${entry.license}`);
	}
});

// macOS hands `credits` to a plain NSAttributedString in a narrow column, so a
// URL it cannot linkify is three wrapped lines of noise per package.
test('linkifies project URLs for GTK and omits them on macOS', () => {
	const options = aboutPanelOptions('en');

	expect(options.authors?.join('\n')).toContain('<https://react.dev/>');
	expect(options.credits).not.toContain('https://react.dev/');
});

test('credits the author first and the inspiration last', () => {
	const options = aboutPanelOptions('en');
	const authors = options.authors ?? [];

	expect(authors[0]).toBe(author.name);
	expect(authors.at(-1)).toBe(
		'Inspired by Conductor <https://conductor.build>',
	);
	expect(options.credits?.trimEnd().endsWith('(conductor.build)')).toBe(true);
});

test('renders the credit headings in the requested language', () => {
	expect(aboutPanelOptions('ru').authors).toContain('Инструменты разработки');
	expect(aboutPanelOptions('el').authors).toContain('Εργαλεία ανάπτυξης');
});
