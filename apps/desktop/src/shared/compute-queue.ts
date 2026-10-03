/**
 * Public entrypoint for the app-wide compute queue's shared surface: the job
 * shapes main reports to the renderer and to agents, and the classifier both
 * agent runtimes use to decide which shell commands must go through the queue.
 *
 * The classifier lives here rather than in either runtime for the reason Plan
 * Mode's does: the Pi extension cannot import from `src/` at runtime, so it asks
 * the app per intercepted call, and the Claude hook runs in main. One copy, two
 * callers, no parity test to police a second.
 */
export { heavyCommandBlockReason } from './compute-queue/block-reason.ts';
export type { HeavyCommandVerdict } from './compute-queue/heavy-command.ts';
export {
	classifyHeavyCommand,
	classifyHeavyCommandForSettings,
} from './compute-queue/heavy-command.ts';
export { DEFAULT_HEAVY_COMMAND_PATTERNS } from './compute-queue/heavy-command-patterns.ts';
export type {
	ComputeJobInitiator,
	ComputeJobKind,
	ComputeJobScript,
	ComputeJobSnapshot,
	ComputeJobState,
	ComputeQueueSnapshot,
} from './compute-queue/types.ts';
export { isComputeJobFinished } from './compute-queue/types.ts';
