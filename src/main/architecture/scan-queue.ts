/**
 * Runs the one-time seed scan off whatever path asked for it, and collapses
 * two asks for the same workspace into one.
 *
 * The scan reads the whole source tree, so it has no business on the workspace
 * creation path the user is waiting on — every entry point here is
 * fire-and-forget. Coalescing matters less now that a workspace is scanned once
 * rather than after every turn, but a creation and a first panel open can still
 * land together, and two tree walks to produce one file is one too many.
 */
import type {
	ArchitectureScanOutcome,
	ArchitectureService,
} from './architecture-service.ts';

/** Fired after a scan settles, so the composition root can broadcast it. */
export type ArchitectureScanListener = (input: {
	outcome: ArchitectureScanOutcome;
	workspaceId: string;
}) => void;

/**
 * Requests the seed scan for one workspace. Injected as a port wherever a
 * workspace comes into existence, so that path needs no knowledge of the
 * architecture concern and tests pass a no-op.
 */
export type ArchitectureScanPort = (input: { workspaceId: string }) => void;

/** Public surface of the scan queue. */
export interface ArchitectureScanQueue {
	/** Awaits every in-flight scan, for the app's shutdown path. */
	awaitInFlight: () => Promise<void>;
	/** Queues the seed scan, coalescing against one already running or pending. */
	queueScan: ArchitectureScanPort;
}

/**
 * Builds the queue.
 * @param architectureService - Service that performs the scan
 * @param onScan - Told about every settled scan, including skipped ones
 * @returns The scan queue
 */
export function createArchitectureScanQueue({
	architectureService,
	onScan,
}: {
	architectureService: ArchitectureService;
	onScan?: ArchitectureScanListener;
}): ArchitectureScanQueue {
	const inFlight = new Map<string, Promise<void>>();
	const pending = new Set<string>();

	/**
	 * Runs one scan and then, if another was requested while it ran, that one —
	 * so a burst settles to a single extra pass rather than one per ask.
	 * @param workspaceId - Workspace to scan
	 */
	const drain = async (workspaceId: string): Promise<void> => {
		while (pending.has(workspaceId)) {
			pending.delete(workspaceId);
			try {
				const outcome = await architectureService.scanIfMissing({
					workspaceId,
				});
				onScan?.({ outcome, workspaceId });
			} catch (error) {
				console.warn(
					'[architecture] seed scan failed; no diagram was written',
					{
						error: error instanceof Error ? error.message : String(error),
						workspaceId,
					},
				);
			}
		}
	};

	const queueScan = ({ workspaceId }: { workspaceId: string }): void => {
		pending.add(workspaceId);
		if (inFlight.has(workspaceId)) {
			return;
		}
		const running = drain(workspaceId).finally(() => {
			inFlight.delete(workspaceId);
		});
		inFlight.set(workspaceId, running);
	};

	return {
		awaitInFlight: async () => {
			await Promise.all([...inFlight.values()]);
		},
		queueScan,
	};
}
