import { describe, expect, test } from 'vitest';

import { relaunchOptions } from '../../src/main/app/relaunch-target';

describe('relaunchOptions', () => {
	test('relaunches the outer .AppImage rather than the extracted binary', () => {
		expect(
			relaunchOptions({
				APPIMAGE: '/home/dev/.local/share/ensemblr/Ensemblr-0.1.5-x64.AppImage',
			}),
		).toEqual({
			execPath: '/home/dev/.local/share/ensemblr/Ensemblr-0.1.5-x64.AppImage',
		});
	});

	test("leaves Electron's default alone when APPIMAGE is unset", () => {
		expect(relaunchOptions({})).toEqual({});
	});

	test('treats an empty APPIMAGE as unset', () => {
		expect(relaunchOptions({ APPIMAGE: '' })).toEqual({});
	});
});
