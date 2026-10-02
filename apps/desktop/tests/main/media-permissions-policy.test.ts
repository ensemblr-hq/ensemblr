import { describe, expect, test } from 'vitest';

import { isPermissionGranted } from '../../src/main/app/media-permissions-policy.ts';

/**
 * Every permission name Electron routes through `setPermissionRequestHandler`
 * or `setPermissionCheckHandler`, taken from its own handler signatures. The
 * policy is a deny-by-default list, so the risk is not that it grants too much
 * — it is that it silently denies a capability the app already relies on.
 */
const ELECTRON_PERMISSIONS = [
	'clipboard-read',
	'clipboard-sanitized-write',
	'deprecated-sync-clipboard-read',
	'display-capture',
	'fileSystem',
	'fullscreen',
	'geolocation',
	'hid',
	'idle-detection',
	'keyboardLock',
	'mediaKeySystem',
	'midi',
	'midiSysex',
	'notifications',
	'openExternal',
	'pointerLock',
	'serial',
	'speaker-selection',
	'storage-access',
	'top-level-storage-access',
	'unknown',
	'usb',
	'window-management',
];

/** Names the policy grants outright, with no media kinds attached. */
const GRANTED_WITHOUT_MEDIA_TYPES = new Set(['clipboard-sanitized-write']);

describe('microphone access', () => {
	test('grants an audio-only media request', () => {
		expect(isPermissionGranted('media', ['audio'])).toBe(true);
	});

	test('refuses a media request that also asks for video', () => {
		expect(isPermissionGranted('media', ['audio', 'video'])).toBe(false);
	});

	test('refuses a video-only media request', () => {
		expect(isPermissionGranted('media', ['video'])).toBe(false);
	});

	test('refuses a media request that names no kind at all', () => {
		expect(isPermissionGranted('media', [])).toBe(false);
		expect(isPermissionGranted('media', undefined)).toBe(false);
	});
});

describe('the rest of the permission surface', () => {
	test.each(ELECTRON_PERMISSIONS)('decides %s deliberately', (permission) => {
		expect(isPermissionGranted(permission, undefined)).toBe(
			GRANTED_WITHOUT_MEDIA_TYPES.has(permission),
		);
	});

	test('grants clipboard writes, which every Copy control depends on', () => {
		expect(isPermissionGranted('clipboard-sanitized-write', undefined)).toBe(
			true,
		);
	});

	test('refuses clipboard reads, since nothing pastes through the API', () => {
		expect(isPermissionGranted('clipboard-read', undefined)).toBe(false);
	});

	test('refuses screen capture even though it is a media-adjacent name', () => {
		expect(isPermissionGranted('display-capture', ['video'])).toBe(false);
	});

	test('refuses a permission name Electron has not shipped yet', () => {
		expect(isPermissionGranted('web-app-installation', undefined)).toBe(false);
	});
});
