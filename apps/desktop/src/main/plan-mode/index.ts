/**
 * Public surface of the main-process Plan Mode concern: the per-session
 * registry the IPC layer writes, the plan-file writer, and the coordinator that
 * saves a finished plan and surfaces it for review without waiting on the user.
 */
export { createPlanSubmission, type PlanSubmission } from './exit-plan-mode.ts';
export {
	createPlanFileWriter,
	type PlanFileWriter,
	type PlanFileWriterOptions,
	type WritePlanFileInput,
} from './plan-file-writer.ts';
export {
	createPlanModeRegistry,
	type PlanModeRegistry,
} from './plan-mode-registry.ts';
