/**
 * The build channel a packaged app was cut on, and the LaunchServices identity
 * each one claims.
 *
 * Every packaged build that shares one bundle id becomes an interchangeable
 * registration for that id: when macOS resolves `dev.ensemblr.app` — e.g. while
 * a spawned child touches LaunchServices during workspace creation — it can
 * relaunch a *different* registered copy, which then hits the running
 * instance's single-instance lock and quits, flashing a stray Dock tile. Only
 * the shipped release may claim the canonical id; every dogfood build gets its
 * own so it can never masquerade as (or collide with) another channel. See
 * docs/adr/0032.
 *
 * This lives in `shared/` because three places need the same table and a second
 * copy would drift: `forge.config.ts` bakes the identity into the bundle,
 * `vite.main.config.mts` defines the channel as a build-time constant, and
 * `src/main/updates/` resolves which release feed the running build may update
 * from. A canary that read the release channel's feed would update itself into
 * a different app.
 */

/** Every build channel `ENSEMBLR_BUILD_CHANNEL` accepts. Release is the default. */
export const KNOWN_CHANNELS = ['release', 'canary', 'dev'] as const;

/** The channel a packaged build was cut on. */
export type BuildChannel = (typeof KNOWN_CHANNELS)[number];

/** Bundle id per channel, baked into the packaged app by `forge.config.ts`. */
export const APP_BUNDLE_IDS: Record<BuildChannel, string> = {
	release: 'dev.ensemblr.app',
	canary: 'dev.ensemblr.app.canary',
	dev: 'dev.ensemblr.app.dev',
};

/** Product name per channel — what the Dock, the menu bar and Finder show. */
export const APP_NAMES: Record<BuildChannel, string> = {
	release: 'Ensemblr',
	canary: 'Ensemblr Canary',
	dev: 'Ensemblr Dev',
};

/**
 * Freedesktop application id per channel, baked into the AppImage's generated
 * `.desktop` file by `forge.config.ts`. It is the Linux counterpart of
 * {@link APP_BUNDLE_IDS}: a launcher keys its entries by this id, so a canary
 * sharing the release's would overwrite the release's launcher entry and its
 * icon.
 */
export const APP_LINUX_APP_IDS: Record<BuildChannel, string> = {
	release: 'ensemblr',
	canary: 'ensemblr-canary',
	dev: 'ensemblr-dev',
};

/**
 * Narrows an `ENSEMBLR_BUILD_CHANNEL` value to a channel, falling back to
 * release so a typo produces the store build rather than an unbuildable one.
 * @param value - The raw environment value, in any case, or undefined
 * @returns The resolved channel
 */
export function resolveBuildChannel(value: string | undefined): BuildChannel {
	const requested = (value ?? 'release').toLowerCase();
	return (KNOWN_CHANNELS as readonly string[]).includes(requested)
		? (requested as BuildChannel)
		: 'release';
}
