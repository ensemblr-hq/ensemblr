import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { app, clipboard, nativeImage, shell } from 'electron';
import type {
	OpenTargetResult,
	WorkspaceOpenTargetBehavior,
	WorkspaceOpenTargetSnapshot,
} from '@/shared/ipc/contracts/open-target';
import type { LocalCommandService } from '../commands';
import {
	type DetectedTargetsMap,
	detectInstalledTargets,
} from './detect-installed-targets';
import {
	findOpenTargetDefinition,
	OPEN_TARGET_REGISTRY,
	type OpenTargetDefinition,
} from './open-target-registry';

const OPEN_BINARY_PATH = '/usr/bin/open';
const OPEN_TIMEOUT_MS = 5000;
const ICON_OUTPUT_SIZE = 64;
const CACHE_FILE_NAME = 'open-targets-cache.v1.json';

interface CachedFileShape {
	snapshots: WorkspaceOpenTargetSnapshot[];
	updatedAt: string;
	version: 1;
}

/** Public surface of the open-target service. */
export interface OpenTargetService {
	/**
	 * Returns the full target list with `installed` flags resolved + real macOS
	 * app icons embedded as data URLs. Numeric shortcuts (1..9) are assigned in
	 * render order to installed entries only.
	 */
	listTargets: () => Promise<WorkspaceOpenTargetSnapshot[]>;
	/**
	 * Synchronous read of the persisted target list — used by the preload
	 * initial-shell snapshot so subsequent launches paint the menu instantly.
	 * Returns null only on the very first launch before detection has ever run.
	 */
	getCachedSnapshots: () => WorkspaceOpenTargetSnapshot[] | null;
	/** Opens the workspace path with the target, or copies the path. */
	openTarget: (input: {
		targetId: string;
		workspacePath: string;
	}) => Promise<OpenTargetResult>;
	/** Re-runs detection. Safe to call from a future "Rescan apps" action. */
	refresh: () => Promise<void>;
}

interface CreateOpenTargetServiceOptions {
	localCommandService: LocalCommandService;
}

interface ResolvedTargets {
	detected: DetectedTargetsMap;
	iconDataUrls: Readonly<Record<string, string | undefined>>;
}

const EMPTY_RESOLVED: ResolvedTargets = {
	detected: {},
	iconDataUrls: {},
};

/**
 * Detection runs once at boot, then is cached to disk under userData so the
 * next launch paints the menu instantly. The on-disk cache is the source of
 * truth for synchronous reads (preload snapshot); a fresh detection runs in
 * the background after `app.whenReady` and rewrites the cache.
 */
export function createOpenTargetService({
	localCommandService,
}: CreateOpenTargetServiceOptions): OpenTargetService {
	let inMemorySnapshots: WorkspaceOpenTargetSnapshot[] | null =
		readSnapshotsFromDisk();
	// One-deep refresh chain: every resolve is appended to the previous one so
	// concurrent callers see a consistent in-memory write order and one rejected
	// run can't pin the service into a permanently-failed state.
	let resolveChain: Promise<ResolvedTargets> = Promise.resolve(EMPTY_RESOLVED);
	let primed = false;

	const runDetection = (): Promise<ResolvedTargets> => {
		return app
			.whenReady()
			.then(() => resolveTargets({ localCommandService }))
			.then((resolved) => {
				const snapshots = buildSnapshots(resolved);
				inMemorySnapshots = snapshots;
				writeSnapshotsToDisk(snapshots);
				return resolved;
			})
			.catch((error: unknown) => {
				// Surface for diagnostics but don't crash the main process; the cached
				// snapshot (if any) remains usable, and the next call can retry.
				console.error('[open-target] detection failed', error);
				return EMPTY_RESOLVED;
			});
	};

	const queueResolve = (): Promise<ResolvedTargets> => {
		resolveChain = resolveChain.then(runDetection, runDetection);
		return resolveChain;
	};

	const ensurePrimed = (): Promise<ResolvedTargets> => {
		if (!primed) {
			primed = true;
			return queueResolve();
		}
		return resolveChain;
	};
	// Prime the cache on construction. Safe because we await `whenReady` inside,
	// and `queueResolve` swallows errors so no unhandled rejection escapes.
	void ensurePrimed();

	const listTargets = async (): Promise<WorkspaceOpenTargetSnapshot[]> => {
		await ensurePrimed();
		return inMemorySnapshots ?? [];
	};

	const getCachedSnapshots = (): WorkspaceOpenTargetSnapshot[] | null => {
		return inMemorySnapshots;
	};

	const openTarget = async ({
		targetId,
		workspacePath,
	}: {
		targetId: string;
		workspacePath: string;
	}): Promise<OpenTargetResult> => {
		const definition = findOpenTargetDefinition(targetId);
		if (!definition) {
			return { ok: false, error: `Unknown open target: ${targetId}` };
		}

		try {
			await dispatchOpen({
				definition,
				localCommandService,
				workspacePath,
			});
			return { ok: true };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Failed to open target.';
			return { ok: false, error: message };
		}
	};

	const refresh = async (): Promise<void> => {
		primed = true;
		await queueResolve();
	};

	return { getCachedSnapshots, listTargets, openTarget, refresh };
}

async function resolveTargets({
	localCommandService,
}: {
	localCommandService: LocalCommandService;
}): Promise<ResolvedTargets> {
	const detected = await detectInstalledTargets({ localCommandService });
	const iconDataUrls = await loadIconDataUrls(detected);
	return { detected, iconDataUrls };
}

/**
 * Renders a thumbnail for each detected `.app` via `createThumbnailFromPath`.
 * On macOS this hooks into QuickLook (not IconServices / NSWorkspace), so it
 * survives the concurrency that crashed `app.getFileIcon`. Failures fall back
 * silently to the named icon in the renderer.
 */
async function loadIconDataUrls(
	detected: DetectedTargetsMap,
): Promise<Readonly<Record<string, string | undefined>>> {
	const entries = await Promise.all(
		Object.entries(detected).map(async ([id, entry]) => {
			if (!entry.installed || !entry.appPath) {
				return [id, undefined] as const;
			}
			const dataUrl = await loadIconDataUrlForApp(entry.appPath);
			return [id, dataUrl ?? undefined] as const;
		}),
	);
	return Object.fromEntries(entries);
}

async function loadIconDataUrlForApp(appPath: string): Promise<string | null> {
	try {
		const image = await nativeImage.createThumbnailFromPath(appPath, {
			height: ICON_OUTPUT_SIZE,
			width: ICON_OUTPUT_SIZE,
		});
		if (image.isEmpty()) {
			return null;
		}
		return image.toDataURL();
	} catch {
		return null;
	}
}

function buildSnapshots(
	resolved: ResolvedTargets,
): WorkspaceOpenTargetSnapshot[] {
	const snapshots: WorkspaceOpenTargetSnapshot[] = [];
	let visibleIndex = 0;
	for (const definition of OPEN_TARGET_REGISTRY) {
		if (!resolved.detected[definition.id]?.installed) {
			continue;
		}
		visibleIndex += 1;
		snapshots.push(
			toSnapshot({
				definition,
				iconDataUrl: resolved.iconDataUrls[definition.id],
				visibleIndex,
			}),
		);
	}
	return snapshots;
}

function toSnapshot({
	definition,
	iconDataUrl,
	visibleIndex,
}: {
	definition: OpenTargetDefinition;
	iconDataUrl: string | undefined;
	visibleIndex: number;
}): WorkspaceOpenTargetSnapshot {
	return {
		behavior: behaviorForDispatch(definition.dispatch.kind),
		...(iconDataUrl ? { iconDataUrl } : {}),
		iconName: definition.iconName,
		id: definition.id,
		installed: true,
		...(definition.isPrimary ? { isPrimary: true } : {}),
		kind: definition.kind,
		label: definition.label,
		numberShortcutLabel: visibleIndex <= 9 ? String(visibleIndex) : '',
		...(definition.shortcutLabel
			? { shortcutLabel: definition.shortcutLabel }
			: {}),
	};
}

function behaviorForDispatch(
	kind: OpenTargetDefinition['dispatch']['kind'],
): WorkspaceOpenTargetBehavior {
	switch (kind) {
		case 'copy-path':
			return 'copy-path';
		case 'reveal-in-finder':
			return 'reveal-in-finder';
		case 'open-app-name':
		case 'open-bundle':
			return 'launch-app';
	}
}

/**
 * Resolves the on-disk cache path. Calling `app.getPath('userData')` requires
 * the app name to be set, which happens early in `main.ts`; the function is
 * still wrapped in a try/catch because the cache is a best-effort optimisation.
 */
function getCachePath(): string | null {
	try {
		return `${app.getPath('userData')}/${CACHE_FILE_NAME}`;
	} catch {
		return null;
	}
}

function readSnapshotsFromDisk(): WorkspaceOpenTargetSnapshot[] | null {
	const cachePath = getCachePath();
	if (!cachePath) {
		return null;
	}
	try {
		const contents = readFileSync(cachePath, 'utf8');
		const parsed = JSON.parse(contents) as CachedFileShape;
		if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots)) {
			return null;
		}
		return parsed.snapshots;
	} catch {
		return null;
	}
}

function writeSnapshotsToDisk(snapshots: WorkspaceOpenTargetSnapshot[]): void {
	const cachePath = getCachePath();
	if (!cachePath) {
		return;
	}
	try {
		mkdirSync(dirname(cachePath), { recursive: true });
		const payload: CachedFileShape = {
			snapshots,
			updatedAt: new Date().toISOString(),
			version: 1,
		};
		writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
	} catch {
		// Best-effort cache; fail silently.
	}
}

async function dispatchOpen({
	definition,
	localCommandService,
	workspacePath,
}: {
	definition: OpenTargetDefinition;
	localCommandService: LocalCommandService;
	workspacePath: string;
}): Promise<void> {
	switch (definition.dispatch.kind) {
		case 'reveal-in-finder':
			shell.showItemInFolder(workspacePath);
			return;
		case 'copy-path':
			clipboard.writeText(workspacePath);
			return;
		case 'open-bundle': {
			const result = await localCommandService.run(
				{
					args: ['-b', definition.dispatch.bundleId, workspacePath],
					command: OPEN_BINARY_PATH,
					timeoutMs: OPEN_TIMEOUT_MS,
				},
				undefined,
			);
			if (result.status !== 'success') {
				throw new Error(
					result.failure?.message ?? `Failed to launch ${definition.label}.`,
				);
			}
			return;
		}
		case 'open-app-name': {
			const result = await localCommandService.run(
				{
					args: ['-a', definition.dispatch.appName, workspacePath],
					command: OPEN_BINARY_PATH,
					timeoutMs: OPEN_TIMEOUT_MS,
				},
				undefined,
			);
			if (result.status !== 'success') {
				throw new Error(
					result.failure?.message ?? `Failed to launch ${definition.label}.`,
				);
			}
			return;
		}
	}
}
