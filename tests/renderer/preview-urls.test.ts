import { expect, test } from 'vitest';

import {
	configuredPreviewUrls,
	interpolatePreviewUrl,
	resolvePreviewUrlOptions,
} from '@/renderer/lib/workbench/preview-urls';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

function snapshotWith(value: unknown): SettingsResolutionSnapshot {
	return {
		app: { diagnostics: [], settings: [] },
		repository: {
			diagnostics: [],
			settings: [
				{
					candidates: [],
					key: 'previewUrls',
					locked: false,
					source: 'sqlite',
					value,
				},
			],
		},
	};
}

test('configuredPreviewUrls keeps only entries with a URL', () => {
	const snapshot = snapshotWith([
		{ name: 'Web', url: 'http://localhost:3000' },
		{ name: 'Empty', url: '   ' },
		{ name: 'Bad' },
	]);
	expect(configuredPreviewUrls(snapshot)).toEqual([
		{ name: 'Web', url: 'http://localhost:3000' },
	]);
	expect(configuredPreviewUrls(undefined)).toEqual([]);
});

test('interpolatePreviewUrl substitutes port and workspace name', () => {
	expect(
		interpolatePreviewUrl(
			'https://$ENSEMBLR_WORKSPACE_NAME.test:$ENSEMBLR_PORT',
			{
				port: 5173,
				workspaceName: 'alpha',
			},
		),
	).toBe('https://alpha.test:5173');
});

test('interpolatePreviewUrl leaves the port token when the port is unknown', () => {
	expect(
		interpolatePreviewUrl('http://localhost:$ENSEMBLR_PORT', {
			port: null,
			workspaceName: 'alpha',
		}),
	).toBe('http://localhost:$ENSEMBLR_PORT');
});

test('resolvePreviewUrlOptions prefers configured entries, else the detected URL', () => {
	expect(
		resolvePreviewUrlOptions({
			configured: [{ name: '', url: 'http://localhost:$ENSEMBLR_PORT' }],
			detectedUrl: 'http://localhost:9999',
			port: 3000,
			workspaceName: 'alpha',
		}),
	).toEqual([{ name: 'Preview 1', url: 'http://localhost:3000' }]);

	expect(
		resolvePreviewUrlOptions({
			configured: [],
			detectedUrl: 'http://localhost:9999',
			port: null,
			workspaceName: 'alpha',
		}),
	).toEqual([{ name: 'Open', url: 'http://localhost:9999' }]);

	expect(
		resolvePreviewUrlOptions({
			configured: [],
			detectedUrl: null,
			port: null,
			workspaceName: 'alpha',
		}),
	).toEqual([]);
});
