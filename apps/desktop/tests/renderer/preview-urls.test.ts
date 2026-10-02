import { expect, test } from 'vitest';

import {
	configuredPreviewUrls,
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

test('resolvePreviewUrlOptions interpolates port and workspace name', () => {
	expect(
		resolvePreviewUrlOptions({
			configured: [
				{
					name: 'Web',
					url: 'https://$ENSEMBLR_WORKSPACE_NAME.test:$ENSEMBLR_PORT',
				},
			],
			detectedUrl: null,
			port: 5173,
			workspaceName: 'alpha',
		}),
	).toEqual([{ name: 'Web', url: 'https://alpha.test:5173' }]);
});

// Agent naming writes a readable workspace name rather than the branch slug it
// used to, so a spaced name is now the common case and a raw substitution would
// emit an invalid URL.
test('resolvePreviewUrlOptions percent-encodes a spaced workspace name', () => {
	expect(
		resolvePreviewUrlOptions({
			configured: [
				{ name: 'Web', url: 'https://preview.test/$ENSEMBLR_WORKSPACE_NAME' },
			],
			detectedUrl: null,
			port: null,
			workspaceName: 'Add dark mode',
		}),
	).toEqual([{ name: 'Web', url: 'https://preview.test/Add%20dark%20mode' }]);
});

// Everything else a workspace name may carry is already URL-safe, so encoding
// must leave a name that worked before byte-identical.
test('resolvePreviewUrlOptions leaves a slug-shaped workspace name untouched', () => {
	expect(
		resolvePreviewUrlOptions({
			configured: [
				{ name: 'Web', url: 'https://$ENSEMBLR_WORKSPACE_NAME.test' },
			],
			detectedUrl: null,
			port: null,
			workspaceName: 'add-dark_mode.2',
		}),
	).toEqual([{ name: 'Web', url: 'https://add-dark_mode.2.test' }]);
});

test('resolvePreviewUrlOptions leaves the port token when the port is unknown', () => {
	expect(
		resolvePreviewUrlOptions({
			configured: [{ name: 'Web', url: 'http://localhost:$ENSEMBLR_PORT' }],
			detectedUrl: null,
			port: null,
			workspaceName: 'alpha',
		}),
	).toEqual([{ name: 'Web', url: 'http://localhost:$ENSEMBLR_PORT' }]);
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
