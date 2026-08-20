import type { DynamicToolUIPart } from 'ai';
import type {
	TimelineActivityNode,
	TimelineActivityRow,
} from '@/renderer/types/agent-timeline';

/**
 * Folding a run of task-creating calls into the one plan it represents.
 *
 * Claude Code files a plan one `TaskCreate` at a time, so a turn that laid out
 * seven steps reports seven calls in a row. Left alone they read as seven
 * unrelated events; folded, they read as the checklist the agent actually wrote.
 */

/** Wire name of the create verb, as `presenterFor` lowercases it. */
const TASK_CREATE = 'taskcreate';

/** Shortest run worth folding — a lone create already reads as one task. */
const MIN_RUN_LENGTH = 2;

/**
 * Whether a node is a plain, successful `TaskCreate` call.
 *
 * A failure keeps its own row: the destructive presentation is the point of it,
 * and folding it away would report a task as planned that was never filed. A
 * node with children is left alone for the same reason — nothing hangs under a
 * create today, and a card cannot show what would.
 * @param node - The activity node to classify
 * @returns True when the node may join a folded run
 */
function isPlannedTaskNode(node: TimelineActivityNode): boolean {
	const { part } = node;
	if (part.type !== 'dynamic-tool' || node.children.length > 0) {
		return false;
	}
	if ('errorText' in part && part.errorText) {
		return false;
	}
	return part.toolName.toLowerCase() === TASK_CREATE;
}

/**
 * Turns one settled run into the row the feed paints for it, leaving a run too
 * short to be a plan as the rows it already was.
 * @param run - The contiguous nodes collected so far
 * @returns The rows to append for the run
 */
function rowsForRun(
	run: readonly TimelineActivityNode[],
): readonly TimelineActivityRow[] {
	if (run.length < MIN_RUN_LENGTH) {
		return run.map((node) => ({ key: node.key, kind: 'node', node }));
	}
	return [
		{
			key: `plan:${run[0]?.key ?? ''}`,
			kind: 'task-plan',
			parts: run.map((node) => node.part as DynamicToolUIPart),
		},
	];
}

/**
 * Folds every contiguous run of `TaskCreate` calls in a level of the activity
 * tree into a single plan row, passing everything else through untouched.
 *
 * Runs are folded per level rather than across the whole turn, so a plan a
 * sub-agent filed stays inside the delegation that filed it.
 * @param nodes - One level's activity nodes, in the order the turn produced them
 * @returns The rows to render for that level
 */
export function foldTaskPlanRuns(
	nodes: readonly TimelineActivityNode[],
): readonly TimelineActivityRow[] {
	const rows: TimelineActivityRow[] = [];
	let run: TimelineActivityNode[] = [];

	for (const node of nodes) {
		if (isPlannedTaskNode(node)) {
			run.push(node);
			continue;
		}
		rows.push(...rowsForRun(run));
		run = [];
		rows.push({ key: node.key, kind: 'node', node });
	}
	rows.push(...rowsForRun(run));

	return rows;
}
