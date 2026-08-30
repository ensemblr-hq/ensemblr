import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { author, homepage, version } from '../../package.json';

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

	const options = aboutPanelOptions();

	expect(options.applicationName).toBe('Ensemblr');
	expect(options.applicationVersion).toBe(version);
	expect(options.copyright).toContain(author.name);
	expect(options.website).toBe(homepage);
});

// Without an explicit path GTK looks the icon up in the desktop's theme, which
// an unintegrated AppImage never installed — so the panel draws a broken image.
test('points the panel at a real icon file on Linux', () => {
	pretendPlatform('linux');

	const options = aboutPanelOptions();

	expect(options.iconPath).toBe(
		path.join(REPO_ROOT, 'assets', 'icons', 'icon-512.png'),
	);
});

// macOS reads the icon off the bundle; a path key it ignores is noise the
// support bundle would have to explain.
test('omits the icon path off Linux, where the platform owns it', () => {
	pretendPlatform('darwin');

	expect(aboutPanelOptions().iconPath).toBeUndefined();
});
