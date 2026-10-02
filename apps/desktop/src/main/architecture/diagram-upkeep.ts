/**
 * Decides whether a workspace's stored diagram has fallen behind the code it
 * draws, which is what the per-turn upkeep block asks an agent to fix.
 *
 * Three gates, cheapest first, because this runs on every agent turn. A
 * workspace nobody has drawn is the common case and costs one failed `stat`:
 * there is no diagram to keep current, and asking for one unprompted would push
 * a feature onto a user who never opened it. Only a workspace that *has* a
 * diagram pays for the change-set read, and only a change set landing inside a
 * component's `sources` pays for the timestamps.
 *
 * Staleness is measured against the stored `generatedAt` rather than the file's
 * mtime so the answer clears itself: an agent that stores an update stamps the
 * document with the current time, every changed file is then older than it, and
 * the bullet disappears without anything having to remember it was shown.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { coverChangedPaths } from '../../shared/architecture-diagram.ts';
import { readArchitectureFile } from './architecture-file.ts';

/**
 * Most covered paths whose timestamps are read. One file newer than the diagram
 * settles the question, so a change set far past this only means the answer was
 * already found — the cap bounds the cost of the case where none is newer.
 */
const MAX_TIMESTAMP_READS = 64;

/** How many component labels the answer carries, which is what a bullet can name. */
const MAX_REPORTED_COMPONENTS = 3;

/** What a workspace's diagram still owes the code it describes. */
export interface DiagramUpkeep {
	/** Labels of the components the change set landed in, capped for a prompt. */
	components: readonly string[];
	/** The stored diagram is behind the code, and an agent should redraw it. */
	stale: boolean;
}

/** The answer for a workspace with nothing to redraw. */
const NOTHING_STALE: DiagramUpkeep = { components: [], stale: false };

/**
 * Reports whether a changed file has been touched since the diagram was drawn.
 * A path that no longer exists counts: a deletion inside a component's sources
 * is exactly the change that leaves a node drawing something that is gone.
 * @param workspaceCwd - Absolute path of the workspace root
 * @param relativePath - Workspace-relative path to measure
 * @param drawnAtMs - When the stored diagram was authored
 * @returns True when the file moved after the diagram was drawn
 */
async function changedSinceDrawn(
	workspaceCwd: string,
	relativePath: string,
	drawnAtMs: number,
): Promise<boolean> {
	try {
		const stats = await stat(path.join(workspaceCwd, relativePath));
		return stats.mtimeMs > drawnAtMs;
	} catch {
		return true;
	}
}

/**
 * Reads what upkeep a workspace's diagram still owes.
 *
 * Best-effort throughout: this feeds a system prompt, so a workspace whose
 * diagram, git, or filesystem cannot be read reports nothing outstanding rather
 * than failing the turn.
 * @param input - The workspace root and a reader for its changed paths.
 * @returns The components the change set landed in, and whether to ask for a redraw.
 */
export async function readDiagramUpkeep({
	changedPaths,
	workspaceCwd,
}: {
	changedPaths: () => Promise<readonly string[]>;
	workspaceCwd: string;
}): Promise<DiagramUpkeep> {
	try {
		const read = await readArchitectureFile(workspaceCwd);
		if (read.status !== 'stored') {
			return NOTHING_STALE;
		}
		const drawnAtMs = Date.parse(read.contents.generatedAt);
		if (Number.isNaN(drawnAtMs)) {
			return NOTHING_STALE;
		}
		const coverage = coverChangedPaths(read.contents.ir, await changedPaths());
		if (coverage.labels.length === 0) {
			return NOTHING_STALE;
		}
		const measured = coverage.paths.slice(0, MAX_TIMESTAMP_READS);
		const moved = await Promise.all(
			measured.map((one) => changedSinceDrawn(workspaceCwd, one, drawnAtMs)),
		);
		return moved.some(Boolean)
			? {
					components: coverage.labels.slice(0, MAX_REPORTED_COMPONENTS),
					stale: true,
				}
			: NOTHING_STALE;
	} catch (cause) {
		console.warn('[architecture] diagram upkeep read failed.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			workspaceCwd,
		});
		return NOTHING_STALE;
	}
}
