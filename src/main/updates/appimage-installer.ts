import { createHash } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';

import type { LinuxUpdateAsset } from './release-feed';
import type { UpdaterEventHandlers } from './update-service';

/**
 * Upper bound on a downloaded AppImage. The real artifact is around 120 MB, so
 * this leaves generous headroom while keeping a wrong URL — an HTML error page
 * is the cheap case, a redirect to something enormous the expensive one — from
 * filling the user's disk before anything checks the hash.
 */
const MAX_APPIMAGE_BYTES = 512 * 1024 * 1024;

/**
 * Deadline on the whole download. Generous on purpose: what it bounds is a
 * connection that has stopped delivering bytes, not a slow one — a 120 MB
 * artifact over a poor link is legitimate and must not be cut off. Without it a
 * stall never rejects, so the service sits on `downloading` forever, refusing
 * every later check as already in flight until the app restarts.
 */
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** Mode the swapped-in AppImage carries, so the desktop entry can still run it. */
const EXECUTABLE_MODE = 0o755;

/**
 * Directory `install.sh` installs into, relative to the XDG data root. The app
 * only ever *rewrites* the manifest it finds there, so this is a place to look
 * rather than one to create.
 */
const INSTALL_MANIFEST_DIRECTORY = 'ensemblr';

/** Filename holding the installed tag, written by `install.sh`. */
const INSTALL_MANIFEST_FILENAME = '.version';

/** Options for {@link createAppImageInstaller}. */
export interface AppImageInstallerOptions {
	/** Absolute path of the running `.AppImage`, from `process.env.APPIMAGE`. */
	appImagePath: string;
	/** Process environment, read for the XDG data root. Injected for tests. */
	env?: NodeJS.ProcessEnv;
	/** Injected so tests resolve without a network and the app uses Node's global. */
	fetchImpl?: typeof fetch;
	/** Home directory the XDG data root falls back under. Injected for tests. */
	homeDirectory?: string;
}

/** Public surface of the AppImage installer. */
export interface AppImageInstaller {
	/**
	 * Applies the staged download by renaming it over the running AppImage.
	 * Called once the agents are down and immediately before the relaunch, so a
	 * quit the user cancels leaves the running build untouched.
	 * @returns True when a staged update was applied
	 */
	applyStaged: () => boolean;
	/**
	 * Downloads the asset, verifies it against GitHub's digest, and stages it
	 * beside the running AppImage. Reports through the handlers registered with
	 * {@link AppImageInstaller.on} rather than throwing, matching Squirrel's
	 * shape so the update service drives both the same way.
	 * @param asset - The `.AppImage` to install and the checksum to prove it
	 * @param version - The version being staged, as the release feed reported it
	 */
	arm: (asset: LinuxUpdateAsset, version: string) => void;
	/** Removes a staged download, for the path where the user switches updates off. */
	discardStaged: () => void;
	/** Registers the handlers `arm` reports through. Called once, from `start`. */
	on: (handlers: UpdaterEventHandlers) => void;
}

/**
 * Builds the Linux counterpart to Squirrel.Mac: it downloads a release's
 * `.AppImage`, proves it against the digest GitHub published, and swaps it over
 * the running file.
 *
 * The swap is a `rename` onto a sibling path rather than a write in place, and
 * that is load-bearing rather than tidy. A running AppImage is a FUSE mount of
 * the very file being replaced; truncating it corrupts the live process, while
 * `rename` is atomic and leaves the old inode alive for as long as the mount
 * holds it. The running app therefore keeps working after its own file has been
 * replaced underneath it, and the new version comes up on the next launch.
 *
 * Staging and applying are deliberately separate. Squirrel means "downloaded,
 * restart to apply" by `ready`, and matching that keeps ADR 0055's rule that
 * switching updates off leaves a staged update inert — here that is a spare file
 * to delete rather than an app already replaced.
 * @param options - The running AppImage's path and the injected environment
 * @returns An installer whose methods report failure rather than throwing
 */
export function createAppImageInstaller({
	appImagePath,
	env = process.env,
	fetchImpl = fetch,
	homeDirectory = process.env.HOME ?? '',
}: AppImageInstallerOptions): AppImageInstaller {
	const stagedPath = join(
		dirname(appImagePath),
		`.${basename(appImagePath)}.ensemblr-update`,
	);
	const partialPath = `${stagedPath}.part`;
	let handlers: UpdaterEventHandlers | null = null;
	let stagedVersion: string | null = null;
	let stagedDigest: string | null = null;

	/**
	 * Deletes a path, ignoring its absence. Cleanup runs on failure paths where a
	 * second error would only mask the first.
	 * @param path - The file to remove
	 */
	const removeQuietly = (path: string): void => {
		try {
			rmSync(path, { force: true });
		} catch (error) {
			console.warn('[updates] could not remove %s', path, error);
		}
	};

	/**
	 * Streams the asset to the partial path while hashing it, so the bytes are
	 * never held in memory and the digest is known the moment the last chunk
	 * lands. The signal covers the body as well as the response, so a stall
	 * part-way through a 120 MB transfer rejects rather than hanging.
	 * @param asset - The asset to download
	 * @returns The hex digest of what was written
	 */
	const downloadAndHash = async (asset: LinuxUpdateAsset): Promise<string> => {
		const response = await fetchImpl(asset.url, {
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`The download answered ${response.status}.`);
		}
		if (!response.body) {
			throw new Error('The download returned no body.');
		}

		const hash = createHash('sha256');
		const handle = await open(partialPath, 'w', EXECUTABLE_MODE);
		let written = 0;
		try {
			for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
				written += chunk.byteLength;
				if (written > MAX_APPIMAGE_BYTES) {
					throw new Error(
						`The download exceeded ${MAX_APPIMAGE_BYTES} bytes, so it is not the AppImage.`,
					);
				}
				hash.update(chunk);
				await handle.write(chunk);
			}
		} finally {
			await handle.close();
		}
		return hash.digest('hex');
	};

	/**
	 * Rewrites the tag `install.sh` recorded, so the shell installer and the app
	 * agree on what is installed and `update.sh` does not re-download a version
	 * the app already applied.
	 *
	 * Two conditions keep this from fabricating state the shell installer never
	 * created: the manifest must already exist, and the running AppImage must sit
	 * in the directory holding it — a hand-placed AppImage elsewhere is nobody's
	 * managed install. The format is copied from what is already in the file
	 * rather than assumed, because the script that writes it lives in another
	 * repository.
	 * @param version - The version now on disk
	 */
	const syncInstallManifest = (version: string): void => {
		const dataRoot = env.XDG_DATA_HOME?.length
			? env.XDG_DATA_HOME
			: join(homeDirectory, '.local', 'share');
		const installDirectory = join(dataRoot, INSTALL_MANIFEST_DIRECTORY);
		const manifestPath = join(installDirectory, INSTALL_MANIFEST_FILENAME);
		if (!existsSync(manifestPath)) {
			return;
		}
		if (resolvePath(dirname(appImagePath)) !== resolvePath(installDirectory)) {
			return;
		}
		try {
			const previous = readFileSync(manifestPath, 'utf8');
			const prefix = previous.trimStart().startsWith('v') ? 'v' : '';
			const trailingNewline = previous.endsWith('\n') ? '\n' : '';
			writeFileSync(manifestPath, `${prefix}${version}${trailingNewline}`);
		} catch (error) {
			console.warn('[updates] could not update the install manifest', error);
		}
	};

	const arm = (asset: LinuxUpdateAsset, version: string): void => {
		void (async () => {
			removeQuietly(partialPath);
			let digest: string;
			try {
				digest = await downloadAndHash(asset);
			} catch (error) {
				removeQuietly(partialPath);
				handlers?.onError(asError(error));
				return;
			}

			const expected = asset.digest.replace(/^sha256:/i, '').toLowerCase();
			if (digest !== expected) {
				removeQuietly(partialPath);
				handlers?.onError(
					new Error(
						`The download hashed to ${digest}, but GitHub published ${expected}.`,
					),
					'update-verification-failed',
				);
				return;
			}

			try {
				chmodSync(partialPath, EXECUTABLE_MODE);
				renameSync(partialPath, stagedPath);
			} catch (error) {
				removeQuietly(partialPath);
				handlers?.onError(asError(error));
				return;
			}
			stagedVersion = version;
			stagedDigest = expected;
			handlers?.onDownloaded();
		})();
	};

	/**
	 * Re-hashes the staged file against the digest it was verified with at
	 * download time. The staged file can sit on disk for days before
	 * {@link applyStaged} runs, and that whole window is otherwise unguarded —
	 * anyone able to write the staging directory could swap it.
	 * @returns True when the staged file still matches the recorded digest
	 */
	const stagedFileStillMatchesDigest = (): boolean => {
		if (!stagedDigest) {
			return true;
		}
		const digest = createHash('sha256')
			.update(readFileSync(stagedPath))
			.digest('hex');
		return digest === stagedDigest;
	};

	const applyStaged = (): boolean => {
		if (!existsSync(stagedPath)) {
			return false;
		}
		if (!stagedFileStillMatchesDigest()) {
			removeQuietly(stagedPath);
			stagedVersion = null;
			stagedDigest = null;
			handlers?.onError(
				new Error('The staged AppImage no longer matches its recorded digest.'),
				'update-verification-failed',
			);
			return false;
		}
		renameSync(stagedPath, appImagePath);
		if (stagedVersion) {
			syncInstallManifest(stagedVersion);
		}
		stagedVersion = null;
		stagedDigest = null;
		return true;
	};

	const discardStaged = (): void => {
		removeQuietly(partialPath);
		removeQuietly(stagedPath);
		stagedVersion = null;
		stagedDigest = null;
	};

	return {
		applyStaged,
		arm,
		discardStaged,
		on: (next: UpdaterEventHandlers) => {
			handlers = next;
		},
	};
}

/**
 * Normalizes a caught value to an `Error`, since the handler contract takes one
 * and a rejected fetch can carry anything.
 * @param error - The caught value
 * @returns The value itself when it is already an Error, else one wrapping it
 */
function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
