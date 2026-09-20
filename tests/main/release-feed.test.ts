import { describe, expect, test } from 'vitest';

import {
	createReleaseFeed,
	resolveRepositorySlug,
	updateFeedAssetName,
} from '../../src/main/updates/release-feed';

const SLUG = 'ensemblr-hq/ensemblr';
const RELEASES_URL = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;
const DOWNLOAD = `https://github.com/${SLUG}/releases/download`;
const DIGEST = `sha256:${'a'.repeat(64)}`;

/** One build target: the platform and arch a feed document is named for. */
interface Target {
	arch: string;
	digest?: string | null;
	platform: 'darwin' | 'linux';
}

const DARWIN_ARM64: Target = { arch: 'arm64', platform: 'darwin' };
const ALL_TARGETS: readonly Target[] = [
	{ arch: 'arm64', platform: 'darwin' },
	{ arch: 'x64', platform: 'darwin' },
	{ arch: 'x64', platform: 'linux' },
	{ arch: 'arm64', platform: 'linux' },
];

/** Download URL of the `.zip` a darwin feed document points at. */
function zipUrl(tag: string): string {
	return `${DOWNLOAD}/${tag}/Ensemblr.zip`;
}

/** Download URL of the per-arch AppImage a linux feed document points at. */
function appImageUrl(tag: string, arch: string): string {
	return `${DOWNLOAD}/${tag}/Ensemblr-${arch}.AppImage`;
}

/** Download URL of a target's feed document asset. */
function feedUrl(tag: string, target: Target): string {
	return `${DOWNLOAD}/${tag}/${updateFeedAssetName(target.platform, target.arch)}`;
}

/**
 * Assembles a release's asset list: the shared `.zip`, and per target its feed
 * document plus — on linux — the AppImage that document's `url` points at,
 * carrying the digest a Linux build verifies against.
 */
function assetsFor(tag: string, targets: readonly Target[]) {
	const assets: {
		browser_download_url: string;
		digest?: string;
		name: string;
	}[] = [{ browser_download_url: zipUrl(tag), name: 'Ensemblr.zip' }];
	for (const target of targets) {
		if (target.platform === 'linux') {
			const digest = target.digest === undefined ? DIGEST : target.digest;
			assets.push({
				browser_download_url: appImageUrl(tag, target.arch),
				...(digest ? { digest } : {}),
				name: `Ensemblr-${target.arch}.AppImage`,
			});
		}
		assets.push({
			browser_download_url: feedUrl(tag, target),
			name: updateFeedAssetName(target.platform, target.arch),
		});
	}
	return assets;
}

/** One release as the GitHub API returns it, carrying the given targets' documents. */
function release(
	tag: string,
	options: { draft?: boolean; targets?: readonly Target[] } = {},
) {
	const targets = options.targets ?? [DARWIN_ARM64];
	return {
		assets: assetsFor(tag, targets),
		draft: options.draft ?? false,
		html_url: `https://github.com/${SLUG}/releases/tag/${tag}`,
		tag_name: tag,
	};
}

/** The stubFetch routes serving each target's feed document for one release. */
function feedRoutes(tag: string, version: string, targets: readonly Target[]) {
	const routes: Record<string, { body: unknown }> = {};
	for (const target of targets) {
		routes[feedUrl(tag, target)] = {
			body: {
				name: version,
				notes: `Notes for ${version}`,
				pub_date: '2026-08-18T04:00:00Z',
				url:
					target.platform === 'linux'
						? appImageUrl(tag, target.arch)
						: zipUrl(tag),
			},
		};
	}
	return routes;
}

/** Builds a fetch stub over a URL→payload map, recording every call. */
function stubFetch(
	routes: Record<
		string,
		{ body?: unknown; headers?: Record<string, string>; status?: number }
	>,
) {
	const calls: { headers: Record<string, string>; url: string }[] = [];
	const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
		const key = String(url);
		calls.push({
			headers: (init?.headers as Record<string, string>) ?? {},
			url: key,
		});
		const route = routes[key];
		if (!route) {
			return new Response('not found', { status: 404 });
		}
		// null rather than '': the Response constructor rejects a body on a
		// null-body status, and 304 is how the ETag path is exercised.
		return new Response(
			route.body === undefined ? null : JSON.stringify(route.body),
			{ headers: route.headers, status: route.status ?? 200 },
		);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

describe('updateFeedAssetName', () => {
	test('darwin arm64 keeps the exact name already-installed clients read', () => {
		expect(updateFeedAssetName('darwin', 'arm64')).toBe(
			'update-darwin-arm64.json',
		);
	});

	test('names a document per platform and arch', () => {
		expect(updateFeedAssetName('linux', 'x64')).toBe('update-linux-x64.json');
		expect(updateFeedAssetName('linux', 'arm64')).toBe(
			'update-linux-arm64.json',
		);
		expect(updateFeedAssetName('darwin', 'x64')).toBe('update-darwin-x64.json');
	});
});

describe('resolveRepositorySlug', () => {
	test('reads the slug this build was cut from', () => {
		expect(resolveRepositorySlug()).toBe(SLUG);
	});
});

describe('createReleaseFeed — architecture selection', () => {
	test.each(ALL_TARGETS)(
		'a $platform $arch build reads its own feed document',
		async (target) => {
			const { fetchImpl } = stubFetch({
				[RELEASES_URL]: { body: [release('v0.2.0', { targets: ALL_TARGETS })] },
				...feedRoutes('v0.2.0', '0.2.0', ALL_TARGETS),
			});
			const feed = createReleaseFeed({
				arch: target.arch,
				fetchImpl,
				platform: target.platform,
				repositorySlug: SLUG,
			});

			expect(await feed.resolve('release', '0.1.0')).toMatchObject({
				candidate: {
					feedUrl: feedUrl('v0.2.0', target),
					version: '0.2.0',
				},
				status: 'ok',
			});
		},
	);

	test('an x64 Mac never falls back to the arm64 document', async () => {
		const targets = [DARWIN_ARM64];
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets })] },
			...feedRoutes('v0.2.0', '0.2.0', targets),
		});
		const feed = createReleaseFeed({
			arch: 'x64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('a release carrying only arm64 documents is no update for an x64 Mac', async () => {
		const targets: Target[] = [
			{ arch: 'arm64', platform: 'darwin' },
			{ arch: 'arm64', platform: 'linux' },
		];
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets })] },
			...feedRoutes('v0.2.0', '0.2.0', targets),
		});
		const feed = createReleaseFeed({
			arch: 'x64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});
});

describe('createReleaseFeed — channel selection', () => {
	test('the release channel takes the highest semver tag, prereleases included', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: {
				body: [
					release('nightly'),
					release('v0.1.0-beta.6'),
					release('v0.1.0-beta.8'),
					release('v0.1.0-beta.7'),
				],
			},
			...feedRoutes('v0.1.0-beta.8', '0.1.0-beta.8', [DARWIN_ARM64]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		const result = await feed.resolve('release', '0.1.0-beta.7');

		expect(result).toMatchObject({
			candidate: { version: '0.1.0-beta.8' },
			status: 'ok',
		});
	});

	test('the canary channel takes the rolling nightly tag and never a v-tag', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v9.9.9'), release('nightly')] },
			...feedRoutes('nightly', '0.1.0-beta.7-nightly.20260819.gabc1234', [
				DARWIN_ARM64,
			]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		const result = await feed.resolve(
			'canary',
			'0.1.0-beta.7-nightly.20260818.gdeadbee',
		);

		expect(result).toMatchObject({
			candidate: { version: '0.1.0-beta.7-nightly.20260819.gabc1234' },
			status: 'ok',
		});
	});

	test('a draft release is never a candidate', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('nightly', { draft: true })] },
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('canary', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('a channel with no published release reports current rather than failing', async () => {
		const { fetchImpl } = stubFetch({ [RELEASES_URL]: { body: [] } });
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('the candidate names the release page a check-only build links to', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0')] },
			...feedRoutes('v0.2.0', '0.2.0', [DARWIN_ARM64]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			candidate: {
				releaseUrl: `https://github.com/${SLUG}/releases/tag/v0.2.0`,
			},
		});
	});
});

describe('createReleaseFeed — platform artifacts', () => {
	const LINUX_X64: Target = { arch: 'x64', platform: 'linux' };

	test('Linux ignores a release whose feed documents are all for other targets', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: {
				body: [release('v0.2.0', { targets: [DARWIN_ARM64] })],
			},
			...feedRoutes('v0.2.0', '0.2.0', [DARWIN_ARM64]),
		});
		const feed = createReleaseFeed({
			arch: 'x64',
			fetchImpl,
			platform: 'linux',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('Linux takes a release that shipped its AppImage', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets: [LINUX_X64] })] },
			...feedRoutes('v0.2.0', '0.2.0', [LINUX_X64]),
		});
		const feed = createReleaseFeed({
			arch: 'x64',
			fetchImpl,
			platform: 'linux',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			candidate: {
				linuxAsset: {
					digest: DIGEST,
					url: appImageUrl('v0.2.0', 'x64'),
				},
				releaseUrl: `https://github.com/${SLUG}/releases/tag/v0.2.0`,
				version: '0.2.0',
			},
			status: 'ok',
		});
	});

	test('Linux resolves the AppImage its own arch names, not another arch', async () => {
		const targets: Target[] = [
			{ arch: 'x64', platform: 'linux' },
			{ arch: 'arm64', platform: 'linux' },
		];
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets })] },
			...feedRoutes('v0.2.0', '0.2.0', targets),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'linux',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			candidate: { linuxAsset: { url: appImageUrl('v0.2.0', 'arm64') } },
			status: 'ok',
		});
	});

	test('Linux ignores a release that carries no assets at all', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: {
				body: [{ ...release('v0.2.0'), assets: [] }],
			},
		});
		const feed = createReleaseFeed({
			arch: 'x64',
			fetchImpl,
			platform: 'linux',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('macOS does not require an AppImage', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0')] },
			...feedRoutes('v0.2.0', '0.2.0', [DARWIN_ARM64]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			candidate: { version: '0.2.0' },
			status: 'ok',
		});
	});
});

describe('createReleaseFeed — version comparison', () => {
	test('an equal version is not an update', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.1.0-beta.7')] },
			...feedRoutes('v0.1.0-beta.7', '0.1.0-beta.7', [DARWIN_ARM64]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0-beta.7')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('an older published version is not an update', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.1.0-beta.6')] },
			...feedRoutes('v0.1.0-beta.6', '0.1.0-beta.6', [DARWIN_ARM64]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0-beta.7')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('a nightly built after a release outranks that release', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('nightly')] },
			...feedRoutes('nightly', '0.1.0-nightly.20260818.gabc1234', [
				DARWIN_ARM64,
			]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		const result = await feed.resolve('canary', '0.1.0-beta.7');

		expect(result).toMatchObject({ status: 'ok' });
		expect(result).not.toEqual({ candidate: null, status: 'ok' });
	});

	// The base in `nightly.yml` is stripped to `<major>.<minor>.<patch>` for
	// exactly this: keeping the `-beta.N` tail would put `9-nightly` and
	// `10-nightly` in the same identifier slot, where semver compares them as
	// strings and the newer build loses.
	test('one nightly outranks the last across a beta bump of the base', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('nightly')] },
			...feedRoutes('nightly', '0.1.0-nightly.20260902.gbbbbbbb', [
				DARWIN_ARM64,
			]),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		const result = await feed.resolve(
			'canary',
			'0.1.0-nightly.20260901.gaaaaaaa',
		);

		expect(result).toMatchObject({
			candidate: { version: '0.1.0-nightly.20260902.gbbbbbbb' },
			status: 'ok',
		});
	});

	test('a build whose own version is not semver refuses rather than guessing', async () => {
		const { fetchImpl } = stubFetch({});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', 'not-a-version')).toMatchObject({
			failure: { code: 'update-unsupported-build' },
			status: 'error',
		});
	});
});

describe('createReleaseFeed — failures and caching', () => {
	test('a rate-limited feed is reported as such, not as unreachable', async () => {
		const { fetchImpl } = stubFetch({ [RELEASES_URL]: { status: 403 } });
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-rate-limited' },
			status: 'error',
		});
	});

	test('a network error is reported as unreachable', async () => {
		const fetchImpl = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-unreachable' },
			status: 'error',
		});
	});

	test('a darwin release carrying no feed document at all is malformed', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets: [] })] },
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('a feed document carrying a non-semver version is malformed', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0')] },
			[feedUrl('v0.2.0', DARWIN_ARM64)]: {
				body: { name: 'latest', url: 'https://example.com/a.zip' },
			},
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('a feed document larger than a feed document can be is malformed', async () => {
		const oversized = 'x'.repeat(64 * 1024 + 1);
		const fetchImpl = (async (url: string | URL) =>
			String(url) === RELEASES_URL
				? new Response(JSON.stringify([release('v0.2.0')]))
				: new Response(oversized)) as unknown as typeof fetch;
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('an asset download URL off the trusted GitHub hosts is malformed', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: {
				body: [
					{
						assets: [
							{
								browser_download_url:
									'https://attacker.example/update-darwin-arm64.json',
								name: 'update-darwin-arm64.json',
							},
						],
						draft: false,
						html_url: `https://github.com/${SLUG}/releases/tag/v0.2.0`,
						tag_name: 'v0.2.0',
					},
				],
			},
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('a feed document URL off the trusted GitHub hosts is malformed', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0')] },
			[feedUrl('v0.2.0', DARWIN_ARM64)]: {
				body: {
					name: '0.2.0',
					url: 'https://attacker.example/Ensemblr.zip',
				},
			},
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('a release list larger than a release list can be is malformed', async () => {
		const oversized = `[${'1'.repeat(2 * 1024 * 1024 + 1)}]`;
		const fetchImpl = (async () =>
			new Response(oversized)) as unknown as typeof fetch;
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('Linux carries no installable asset when GitHub published no digest', async () => {
		const targets: Target[] = [
			{ arch: 'x64', digest: null, platform: 'linux' },
		];
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets })] },
			...feedRoutes('v0.2.0', '0.2.0', targets),
		});
		const feed = createReleaseFeed({
			arch: 'x64',
			fetchImpl,
			platform: 'linux',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			candidate: { linuxAsset: null, version: '0.2.0' },
			status: 'ok',
		});
	});

	test('darwin carries no Linux asset even when the release ships one', async () => {
		const targets: Target[] = [
			DARWIN_ARM64,
			{ arch: 'x64', platform: 'linux' },
		];
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { targets })] },
			...feedRoutes('v0.2.0', '0.2.0', targets),
		});
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			candidate: { linuxAsset: null, version: '0.2.0' },
			status: 'ok',
		});
	});

	test('sends the stored ETag and reuses the cached list on a 304', async () => {
		const releasesBody = [release('v0.2.0')];
		const routes: Record<
			string,
			{ body?: unknown; headers?: Record<string, string>; status?: number }
		> = {
			[RELEASES_URL]: { body: releasesBody, headers: { etag: 'W/"abc"' } },
			...feedRoutes('v0.2.0', '0.2.0', [DARWIN_ARM64]),
		};
		const { calls, fetchImpl } = stubFetch(routes);
		const feed = createReleaseFeed({
			arch: 'arm64',
			fetchImpl,
			platform: 'darwin',
			repositorySlug: SLUG,
		});

		await feed.resolve('release', '0.1.0');
		routes[RELEASES_URL] = { status: 304 };
		const second = await feed.resolve('release', '0.1.0');

		expect(second).toMatchObject({
			candidate: { version: '0.2.0' },
			status: 'ok',
		});
		const releaseCalls = calls.filter((call) => call.url === RELEASES_URL);
		expect(releaseCalls).toHaveLength(2);
		expect(releaseCalls[1]?.headers['if-none-match']).toBe('W/"abc"');
	});
});
