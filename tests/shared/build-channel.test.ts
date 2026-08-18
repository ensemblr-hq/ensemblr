import { describe, expect, test } from 'vitest';

import {
	APP_BUNDLE_IDS,
	APP_NAMES,
	KNOWN_CHANNELS,
	resolveBuildChannel,
} from '../../src/shared/build-channel';

describe('resolveBuildChannel', () => {
	test('resolves every known channel', () => {
		for (const channel of KNOWN_CHANNELS) {
			expect(resolveBuildChannel(channel)).toBe(channel);
		}
	});

	test('accepts any case, matching what a shell variable may carry', () => {
		expect(resolveBuildChannel('CANARY')).toBe('canary');
		expect(resolveBuildChannel('Dev')).toBe('dev');
	});

	test('falls back to release for an unset or unrecognised value', () => {
		expect(resolveBuildChannel(undefined)).toBe('release');
		expect(resolveBuildChannel('')).toBe('release');
		expect(resolveBuildChannel('nightly')).toBe('release');
	});
});

describe('channel identities', () => {
	test('every channel has its own bundle id and product name', () => {
		const ids = KNOWN_CHANNELS.map((channel) => APP_BUNDLE_IDS[channel]);
		const names = KNOWN_CHANNELS.map((channel) => APP_NAMES[channel]);

		expect(new Set(ids).size).toBe(KNOWN_CHANNELS.length);
		expect(new Set(names).size).toBe(KNOWN_CHANNELS.length);
	});

	test('only release claims the canonical identity', () => {
		expect(APP_BUNDLE_IDS.release).toBe('dev.ensemblr.app');
		expect(APP_NAMES.release).toBe('Ensemblr');
		for (const channel of KNOWN_CHANNELS.filter((it) => it !== 'release')) {
			expect(APP_BUNDLE_IDS[channel].startsWith('dev.ensemblr.app.')).toBe(
				true,
			);
		}
	});
});
