import {
	HARNESS_REGISTRY,
	type HarnessDefinition,
} from '../../shared/agents/harness-registry.ts';
import type {
	AgentHarnessSummary,
	ListAgentHarnessesResult,
} from '../../shared/ipc/contracts/agents.ts';
import type { LocalCommandService } from '../commands/local-command';
import {
	findExecutableInCommonDirs,
	findExecutableOnPath,
} from '../pi-runtime/executable-discovery.ts';

/** How long a detection result stays cached before PATH is re-probed. */
const DETECTION_CACHE_TTL_MS = 30_000;

/** Public surface of the harness detection service. */
export interface HarnessDetectionService {
	/**
	 * Lists every known harness with whether its binary is installed, using the
	 * user's login-shell PATH. Results are cached briefly per resolved PATH.
	 */
	listHarnesses: () => Promise<ListAgentHarnessesResult>;
	/**
	 * Resolves the trusted launch command for an installed harness, rebuilt from
	 * the registry so renderer input never becomes shell text.
	 * @param harnessId - The registry id to launch.
	 * @returns The command string, or null when the id is unknown or absent.
	 */
	resolveLaunchCommand: (harnessId: string) => Promise<string | null>;
	/**
	 * Resolves the trusted resume command for an installed harness, reattaching
	 * its most recent conversation in the cwd. Falls back to the fresh launch
	 * command for harnesses without a cwd-scoped resume.
	 * @param harnessId - The registry id to resume.
	 * @returns The command string, or null when the id is unknown or absent.
	 */
	resolveResumeCommand: (harnessId: string) => Promise<string | null>;
}

/** Internal cache entry keyed on the resolved PATH string. */
interface DetectionCacheEntry {
	pathKey: string;
	expiresAt: number;
	commandById: Map<string, string | null>;
	resumeCommandById: Map<string, string | null>;
}

/**
 * Resolves the executable a harness would launch with, preferring the
 * shell-derived PATH and falling back to the common install directories.
 * @param harness - The harness definition to resolve.
 * @param pathValue - The login-shell PATH to search.
 * @param commonDirs - Fallback install directories to search after PATH.
 * @returns The resolved binary name/path, or null when none of its candidates exist.
 */
function resolveHarnessBinary(
	harness: HarnessDefinition,
	pathValue: string,
	commonDirs: readonly string[] | undefined,
): string | null {
	for (const binary of harness.binaries) {
		const onPath = findExecutableOnPath(binary, pathValue);
		if (onPath) {
			return binary;
		}
		const inCommonDir = findExecutableInCommonDirs(
			binary,
			undefined,
			commonDirs,
		);
		if (inCommonDir) {
			return inCommonDir;
		}
	}
	return null;
}

/**
 * Builds the harness detection service used by the agents IPC handlers.
 * @param options - Service dependencies.
 * @returns A {@link HarnessDetectionService}.
 */
export function createHarnessDetectionService({
	commonDirs,
	localCommandService,
	now = () => Date.now(),
	registry = HARNESS_REGISTRY,
}: {
	/** Fallback install directories searched after PATH; defaults to the common set. */
	commonDirs?: readonly string[];
	localCommandService: LocalCommandService;
	now?: () => number;
	/** Harness catalog to detect against; defaults to the shared registry (overridable for tests). */
	registry?: readonly HarnessDefinition[];
}): HarnessDetectionService {
	let cache: DetectionCacheEntry | null = null;

	/**
	 * Looks up a harness in the active registry by id.
	 * @param harnessId - The harness id to resolve.
	 * @returns The matching definition, or undefined when the id is unknown.
	 */
	function findHarness(harnessId: string): HarnessDefinition | undefined {
		return registry.find((harness) => harness.id === harnessId);
	}

	/**
	 * Resolves the current login-shell PATH and returns a fresh command-by-id map,
	 * reusing a cached map while it is valid for the same PATH.
	 * @returns The resolved PATH plus each harness's launch command (null if absent).
	 */
	async function resolveCommands(): Promise<DetectionCacheEntry> {
		const environment = await localCommandService.getEnvironment();
		const pathKey = environment.path;
		const current = now();
		if (cache && cache.pathKey === pathKey && cache.expiresAt > current) {
			return cache;
		}
		const commandById = new Map<string, string | null>();
		const resumeCommandById = new Map<string, string | null>();
		for (const harness of registry) {
			const binary = resolveHarnessBinary(harness, pathKey, commonDirs);
			commandById.set(harness.id, binary ? harness.buildCommand(binary) : null);
			resumeCommandById.set(
				harness.id,
				binary
					? (harness.buildResumeCommand ?? harness.buildCommand)(binary)
					: null,
			);
		}
		cache = {
			commandById,
			expiresAt: current + DETECTION_CACHE_TTL_MS,
			pathKey,
			resumeCommandById,
		};
		return cache;
	}

	return {
		listHarnesses: async (): Promise<ListAgentHarnessesResult> => {
			const resolved = await resolveCommands();
			const harnesses: AgentHarnessSummary[] = registry.map((harness) => ({
				available: resolved.commandById.get(harness.id) !== null,
				id: harness.id,
				label: harness.label,
			}));
			return { harnesses };
		},
		resolveLaunchCommand: async (harnessId): Promise<string | null> => {
			if (!findHarness(harnessId)) {
				return null;
			}
			const resolved = await resolveCommands();
			return resolved.commandById.get(harnessId) ?? null;
		},
		resolveResumeCommand: async (harnessId): Promise<string | null> => {
			if (!findHarness(harnessId)) {
				return null;
			}
			const resolved = await resolveCommands();
			return resolved.resumeCommandById.get(harnessId) ?? null;
		},
	};
}
