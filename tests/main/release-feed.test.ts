import { describe, expect, test } from 'vitest';

import {
	createReleaseFeed,
	resolveRepositorySlug,
	UPDATE_FEED_ASSET_NAME,
} from '../../src/main/updates/release-feed';

const SLUG = 'ensemblr-hq/ensemblr';
const RELEASES_URL = `https://api.github.com/repos/${SLUG}/releases?per_page=30`;

/** One release as the GitHub API returns it, trimmed to the fields the resolver reads. */
function release(
	tag: string,
	options: {
		draft?: boolean;
		feedUrl?: string | null;
		prerelease?: boolean;
	} = {},
) {
	const feedUrl =
		options.feedUrl === undefined
			? `https://github.com/${SLUG}/releases/download/${tag}/${UPDATE_FEED_ASSET_NAME}`
			: options.feedUrl;
	return {
		assets: [
			{
				browser_download_url: `https://github.com/${SLUG}/releases/download/${tag}/Ensemblr.zip`,
				name: 'Ensemblr.zip',
			},
			...(feedUrl
				? [{ browser_download_url: feedUrl, name: UPDATE_FEED_ASSET_NAME }]
				: []),
		],
		draft: options.draft ?? false,
		prerelease: options.prerelease ?? true,
		tag_name: tag,
	};
}

/** A Squirrel feed document as the release workflows write it. */
function feedDocument(version: string) {
	return {
		name: version,
		notes: `Notes for ${version}`,
		pub_date: '2026-08-18T04:00:00Z',
		url: `https://github.com/${SLUG}/releases/download/x/Ensemblr.zip`,
	};
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

describe('resolveRepositorySlug', () => {
	test('reads the slug this build was cut from', () => {
		expect(resolveRepositorySlug()).toBe(SLUG);
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
			[`https://github.com/${SLUG}/releases/download/v0.1.0-beta.8/${UPDATE_FEED_ASSET_NAME}`]:
				{ body: feedDocument('0.1.0-beta.8') },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		const result = await feed.resolve('release', '0.1.0-beta.7');

		expect(result).toMatchObject({
			candidate: { version: '0.1.0-beta.8' },
			status: 'ok',
		});
	});

	test('the canary channel takes the rolling nightly tag and never a v-tag', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v9.9.9'), release('nightly')] },
			[`https://github.com/${SLUG}/releases/download/nightly/${UPDATE_FEED_ASSET_NAME}`]:
				{ body: feedDocument('0.1.0-beta.7-nightly.20260819.gabc1234') },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

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
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('canary', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('a channel with no published release reports current rather than failing', async () => {
		const { fetchImpl } = stubFetch({ [RELEASES_URL]: { body: [] } });
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});
});

describe('createReleaseFeed — version comparison', () => {
	test('an equal version is not an update', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.1.0-beta.7')] },
			[`https://github.com/${SLUG}/releases/download/v0.1.0-beta.7/${UPDATE_FEED_ASSET_NAME}`]:
				{ body: feedDocument('0.1.0-beta.7') },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0-beta.7')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('an older published version is not an update', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.1.0-beta.6')] },
			[`https://github.com/${SLUG}/releases/download/v0.1.0-beta.6/${UPDATE_FEED_ASSET_NAME}`]:
				{ body: feedDocument('0.1.0-beta.6') },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0-beta.7')).toEqual({
			candidate: null,
			status: 'ok',
		});
	});

	test('a nightly built after a release outranks that release', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('nightly')] },
			[`https://github.com/${SLUG}/releases/download/nightly/${UPDATE_FEED_ASSET_NAME}`]:
				{ body: feedDocument('0.1.0-beta.7-nightly.20260818.gabc1234') },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		const result = await feed.resolve('canary', '0.1.0-beta.7');

		expect(result).toMatchObject({ status: 'ok' });
		expect(result).not.toEqual({ candidate: null, status: 'ok' });
	});

	test('a build whose own version is not semver refuses rather than guessing', async () => {
		const { fetchImpl } = stubFetch({});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', 'not-a-version')).toMatchObject({
			failure: { code: 'update-unsupported-build' },
			status: 'error',
		});
	});
});

describe('createReleaseFeed — failures and caching', () => {
	test('a rate-limited feed is reported as such, not as unreachable', async () => {
		const { fetchImpl } = stubFetch({ [RELEASES_URL]: { status: 403 } });
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-rate-limited' },
			status: 'error',
		});
	});

	test('a network error is reported as unreachable', async () => {
		const fetchImpl = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-unreachable' },
			status: 'error',
		});
	});

	test('a release without the feed asset is malformed, not up to date', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0', { feedUrl: null })] },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('a feed document carrying a non-semver version is malformed', async () => {
		const { fetchImpl } = stubFetch({
			[RELEASES_URL]: { body: [release('v0.2.0')] },
			[`https://github.com/${SLUG}/releases/download/v0.2.0/${UPDATE_FEED_ASSET_NAME}`]:
				{ body: { name: 'latest', url: 'https://example.com/a.zip' } },
		});
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

		expect(await feed.resolve('release', '0.1.0')).toMatchObject({
			failure: { code: 'update-feed-malformed' },
			status: 'error',
		});
	});

	test('sends the stored ETag and reuses the cached list on a 304', async () => {
		const releasesBody = [release('v0.2.0')];
		const documentUrl = `https://github.com/${SLUG}/releases/download/v0.2.0/${UPDATE_FEED_ASSET_NAME}`;
		const routes: Record<
			string,
			{ body?: unknown; headers?: Record<string, string>; status?: number }
		> = {
			[RELEASES_URL]: { body: releasesBody, headers: { etag: 'W/"abc"' } },
			[documentUrl]: { body: feedDocument('0.2.0') },
		};
		const { calls, fetchImpl } = stubFetch(routes);
		const feed = createReleaseFeed({ fetchImpl, repositorySlug: SLUG });

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
