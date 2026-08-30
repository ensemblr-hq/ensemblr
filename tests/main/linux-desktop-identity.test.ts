import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { APP_LINUX_APP_IDS } from '../../src/shared/build-channel.ts';

const REAL_PLATFORM = process.platform;
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const appStub = vi.hoisted(() => ({
	getAppPath: vi.fn(() => ''),
	isPackaged: false,
	setDesktopName: vi.fn(),
}));

vi.mock('electron', () => ({ app: appStub }));

const { applyLinuxDesktopIdentity, linuxWindowIconPath } = await import(
	'../../src/main/app/linux-desktop-identity.ts'
);

/**
 * Overrides the reported platform for one test, so the Linux-only guards can be
 * exercised from a macOS or CI host.
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
});

afterEach(() => {
	Object.defineProperty(process, 'platform', {
		configurable: true,
		value: REAL_PLATFORM,
	});
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('applyLinuxDesktopIdentity', () => {
	// Electron turns this name into the XDG app id on Wayland and `WM_CLASS` on
	// X11. It has to name the `.desktop` file the AppImage maker writes, or the
	// desktop cannot pair the window with its entry and draws a generic icon.
	test('claims the desktop entry the AppImage maker installs', () => {
		pretendPlatform('linux');

		applyLinuxDesktopIdentity();

		expect(appStub.setDesktopName).toHaveBeenCalledWith(
			`${APP_LINUX_APP_IDS.release}.desktop`,
		);
	});

	test('leaves the identity alone off Linux', () => {
		pretendPlatform('darwin');

		applyLinuxDesktopIdentity();

		expect(appStub.setDesktopName).not.toHaveBeenCalled();
	});

	// A dogfood channel that claimed the release's entry would overwrite its
	// launcher entry and its icon — the Linux reading of ADR 0032.
	test('gives every channel its own id', () => {
		pretendPlatform('linux');
		vi.stubGlobal('__ENSEMBLR_BUILD_CHANNEL__', 'canary');

		applyLinuxDesktopIdentity();

		expect(appStub.setDesktopName).toHaveBeenCalledWith(
			`${APP_LINUX_APP_IDS.canary}.desktop`,
		);
		expect(appStub.setDesktopName).not.toHaveBeenCalledWith(
			`${APP_LINUX_APP_IDS.release}.desktop`,
		);
	});
});

describe('linuxWindowIconPath', () => {
	test('resolves the generated icon out of the repo in dev', () => {
		pretendPlatform('linux');

		expect(linuxWindowIconPath()).toBe(
			path.join(REPO_ROOT, 'assets', 'icons', 'icon-512.png'),
		);
	});

	test('has nothing to offer off Linux, where the bundle carries the icon', () => {
		pretendPlatform('darwin');

		expect(linuxWindowIconPath()).toBeUndefined();
	});

	// A missing file would make Electron log an image-load failure on every
	// launch; reporting undefined leaves the window on the desktop's fallback.
	test('reports nothing rather than a path that is not there', () => {
		pretendPlatform('linux');
		appStub.getAppPath.mockReturnValue(path.join(REPO_ROOT, 'no-such-dir'));

		expect(linuxWindowIconPath()).toBeUndefined();
	});
});
