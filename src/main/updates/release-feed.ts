import semver from 'semver';
import { z } from 'zod';

import { repository } from '../../../package.json';
import type { BuildChannel } from '../../shared/build-channel';
import type {
	UpdateFailure,
	UpdateFailureCode,
} from '../../shared/ipc/contracts/update';

/**
 * Name of the Squirrel.Mac feed document both release workflows attach to every
 * release, beside the `.zip` it points at. A cross-repo contract with
 * `.github/workflows/release.yml` and `nightly.yml` — renaming it here without
 * renaming it there strands every installed build on its current version.
 */
export const UPDATE_FEED_ASSET_NAME = 'update-darwin-arm64.json';

/**
 * Tag the rolling nightly release always carries. Reserved by ADR 0054: a
 * `v<semver>` tag is a real release, the literal `nightly` is the nightly, and
 * nothing else publishes.
 */
const NIGHTLY_TAG = 'nightly';

/** How many releases to read per check. Far more than the nightly plus the live betas. */
const RELEASES_PAGE_SIZE = 30;

/** Upper bound on a feed document, which is a handful of fields and never large. */
const MAX_FEED_BYTES = 64 * 1024;

/**
 * The GitHub release fields this resolver reads. `unknown` elsewhere on the
 * object is expected — the API returns far more than this and none of it is
 * trusted.
 */
const releaseSchema = z.object({
	assets: z
		.object({
			browser_download_url: z.string().url(),
			name: z.string(),
		})
		.array(),
	draft: z.boolean().optional(),
	prerelease: z.boolean().optional(),
	tag_name: z.string(),
});

/** The Squirrel.Mac feed document, as the release workflows write it. */
const feedDocumentSchema = z.object({
	name: z.string().min(1),
	notes: z.string().optional(),
	url: z.string().url(),
});

/** One GitHub release, narrowed to the fields this resolver trusts. */
type Release = z.infer<typeof releaseSchema>;

/** A release newer than the running build, and the feed URL Squirrel should be pointed at. */
export interface UpdateCandidate {
	feedUrl: string;
	notes: string | null;
	version: string;
}

/**
 * Outcome of one resolution. A null `candidate` means the check succeeded and
 * the running build is current — distinct from an error, which must be shown.
 */
export type ReleaseFeedResult =
	| { candidate: UpdateCandidate | null; status: 'ok' }
	| { failure: UpdateFailure; status: 'error' };

/** Public surface of the release feed resolver. */
export interface ReleaseFeed {
	/**
	 * Resolves the release this channel would update to.
	 * @param channel - The running build's channel; never crosses to another
	 * @param currentVersion - The running build's version
	 */
	resolve: (
		channel: BuildChannel,
		currentVersion: string,
	) => Promise<ReleaseFeedResult>;
}

/** Options for {@link createReleaseFeed}. */
export interface ReleaseFeedOptions {
	/** Injected so tests resolve without a network and the app uses Node's global. */
	fetchImpl?: typeof fetch;
	/** `owner/repo` to read releases from; defaults to the one this build was cut from. */
	repositorySlug?: string;
}

/**
 * Outcome of one internal read. Discriminated on `ok` rather than reusing
 * {@link ReleaseFeedResult}, whose success arm carries a candidate and so cannot
 * narrow against a success arm carrying anything else.
 */
type ReadFailure = { failure: UpdateFailure; ok: false };
type Read<T> = ReadFailure | { ok: true; value: T };

/**
 * Builds one coded failure.
 * @param code - The failure category
 * @param message - English prose for the support bundle; the renderer translates the code
 * @returns The failed read
 */
function fail(code: UpdateFailureCode, message: string): ReadFailure {
	return { failure: { code, message }, ok: false };
}

/**
 * Reads the `owner/repo` slug out of the package manifest, so a fork updates
 * from its own releases rather than from this repository's.
 * @returns The slug, e.g. `ensemblr-hq/ensemblr`
 */
export function resolveRepositorySlug(): string {
	const match = repository.url.match(
		/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
	);
	if (!match) {
		throw new Error(`Cannot read a GitHub slug from "${repository.url}"`);
	}
	return `${match[1]}/${match[2]}`;
}

/**
 * Whether a release belongs to a channel's feed. Canary tracks the rolling
 * `nightly` tag; release tracks the `v<semver>` tags, prereleases included —
 * every Ensemblr release so far is one.
 * @param release - The release to test
 * @param channel - The channel resolving its feed
 * @returns True when this release is a candidate for that channel
 */
function belongsToChannel(release: Release, channel: BuildChannel): boolean {
	if (release.draft) {
		return false;
	}
	if (channel === 'canary') {
		return release.tag_name === NIGHTLY_TAG;
	}
	return (
		release.tag_name !== NIGHTLY_TAG && semver.valid(release.tag_name) !== null
	);
}

/**
 * Picks the release a channel would install: the single rolling nightly, or the
 * highest-semver `v<semver>` tag.
 * @param releases - Every release read from the API
 * @param channel - The channel resolving its feed
 * @returns The chosen release, or null when the channel has none published
 */
function pickRelease(
	releases: readonly Release[],
	channel: BuildChannel,
): Release | null {
	const candidates = releases.filter((release) =>
		belongsToChannel(release, channel),
	);
	if (candidates.length === 0) {
		return null;
	}
	if (channel === 'canary') {
		return candidates[0] ?? null;
	}
	return candidates.reduce((newest, release) =>
		semver.gt(release.tag_name, newest.tag_name) ? release : newest,
	);
}

/**
 * Reads a response body without letting an unexpected payload grow unbounded.
 * @param response - The response to read
 * @param limit - Maximum bytes to accept
 * @returns The body text, or null when it exceeded the limit
 */
async function readBoundedText(
	response: Response,
	limit: number,
): Promise<string | null> {
	const text = await response.text();
	return text.length > limit ? null : text;
}

/**
 * Builds the release-feed resolver.
 *
 * It resolves in two hops rather than one: the releases API names the release,
 * and that release's feed document carries the exact version. Reading the
 * version from the document is what lets the rolling `nightly` tag — whose name
 * never changes — report a new version each night without anyone parsing prose
 * out of a release body.
 * @param options - Injected fetch and repository slug
 * @returns A resolver whose `resolve` never throws across its boundary
 */
export function createReleaseFeed({
	fetchImpl = fetch,
	repositorySlug = resolveRepositorySlug(),
}: ReleaseFeedOptions = {}): ReleaseFeed {
	const releasesUrl = `https://api.github.com/repos/${repositorySlug}/releases?per_page=${RELEASES_PAGE_SIZE}`;
	let cachedEtag: string | null = null;
	let cachedReleases: readonly Release[] | null = null;

	/**
	 * Reads the releases list, reusing the cached copy on a 304. A conditional
	 * request that hits does not count against the unauthenticated rate limit,
	 * which is what keeps a periodic check well inside 60/hour.
	 * @returns The releases, or a coded failure
	 */
	const readReleases = async (): Promise<Read<readonly Release[]>> => {
		let response: Response;
		try {
			response = await fetchImpl(releasesUrl, {
				headers: {
					accept: 'application/vnd.github+json',
					...(cachedEtag ? { 'if-none-match': cachedEtag } : {}),
				},
			});
		} catch (error) {
			return fail(
				'update-feed-unreachable',
				`Could not reach the release feed: ${String(error)}`,
			);
		}

		if (response.status === 304 && cachedReleases) {
			return { ok: true, value: cachedReleases };
		}
		if (response.status === 403 || response.status === 429) {
			return fail(
				'update-feed-rate-limited',
				'GitHub rate-limited the release feed; the next check will retry.',
			);
		}
		if (!response.ok) {
			return fail(
				'update-feed-unreachable',
				`The release feed answered ${response.status}.`,
			);
		}

		const parsed = releaseSchema.array().safeParse(await response.json());
		if (!parsed.success) {
			return fail(
				'update-feed-malformed',
				'The release feed returned a shape this build does not understand.',
			);
		}
		cachedEtag = response.headers.get('etag');
		cachedReleases = parsed.data;
		return { ok: true, value: parsed.data };
	};

	/**
	 * Reads one release's Squirrel feed document.
	 * @param feedUrl - Download URL of the feed asset
	 * @returns The parsed document, or a coded failure
	 */
	const readFeedDocument = async (
		feedUrl: string,
	): Promise<Read<z.infer<typeof feedDocumentSchema>>> => {
		let response: Response;
		try {
			response = await fetchImpl(feedUrl, {
				headers: { accept: 'application/json' },
			});
		} catch (error) {
			return fail(
				'update-feed-unreachable',
				`Could not read the update feed document: ${String(error)}`,
			);
		}
		if (!response.ok) {
			return fail(
				'update-feed-unreachable',
				`The update feed document answered ${response.status}.`,
			);
		}
		const body = await readBoundedText(response, MAX_FEED_BYTES);
		if (body === null) {
			return fail(
				'update-feed-malformed',
				'The update feed document was larger than a feed document can be.',
			);
		}
		const parsed = feedDocumentSchema.safeParse(safeParseJson(body));
		if (!parsed.success || semver.valid(parsed.data.name) === null) {
			return fail(
				'update-feed-malformed',
				'The update feed document did not carry a usable version and URL.',
			);
		}
		return { ok: true, value: parsed.data };
	};

	/**
	 * Resolves the release this channel would update to, in two hops: the API
	 * names the release, its feed document states the version.
	 * @param channel - The running build's channel
	 * @param currentVersion - The running build's version
	 * @returns The candidate, no candidate, or a coded failure
	 */
	const resolve = async (
		channel: BuildChannel,
		currentVersion: string,
	): Promise<ReleaseFeedResult> => {
		if (semver.valid(currentVersion) === null) {
			return errored(
				fail(
					'update-unsupported-build',
					`This build reports a version semver cannot read: "${currentVersion}".`,
				),
			);
		}

		const listed = await readReleases();
		if (!listed.ok) {
			return errored(listed);
		}

		const release = pickRelease(listed.value, channel);
		if (!release) {
			return { candidate: null, status: 'ok' };
		}
		const asset = release.assets.find(
			(entry) => entry.name === UPDATE_FEED_ASSET_NAME,
		);
		if (!asset) {
			return errored(
				fail(
					'update-feed-malformed',
					`Release ${release.tag_name} carries no ${UPDATE_FEED_ASSET_NAME}.`,
				),
			);
		}

		const read = await readFeedDocument(asset.browser_download_url);
		if (!read.ok) {
			return errored(read);
		}
		if (!semver.gt(read.value.name, currentVersion)) {
			return { candidate: null, status: 'ok' };
		}
		return {
			candidate: {
				feedUrl: asset.browser_download_url,
				notes: read.value.notes ?? null,
				version: read.value.name,
			},
			status: 'ok',
		};
	};

	return { resolve };
}

/**
 * Lifts a failed read to the resolver's own result type.
 * @param read - The failed read
 * @returns The errored result
 */
function errored(read: ReadFailure): ReleaseFeedResult {
	return { failure: read.failure, status: 'error' };
}

/**
 * Parses JSON without throwing, so a truncated or HTML response reads as a
 * malformed feed rather than an unhandled rejection.
 * @param body - The response body
 * @returns The parsed value, or null when it is not JSON
 */
function safeParseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}
