/**
 * Public surface of the app-wide compute queue: the service factory main wires
 * once, and the contract agent-control ops and IPC handlers program against.
 */
export type {
	CommandLaunch,
	CommandRun,
	CommandRunOutcome,
	CommandStarter,
} from './command-runner.ts';
export type {
	AssembledComputeEnvironment,
	CreateComputeQueueServiceOptions,
} from './compute-queue-service.ts';
export { createComputeQueueService } from './compute-queue-service.ts';
export type {
	ComputeJobFilter,
	ComputeJobOwner,
	ComputeJobResult,
	ComputeQueueService,
	EnqueueCommandOutcome,
	EnqueueCommandRequest,
	EnqueueFailureCode,
	ScriptLease,
	ScriptLeaseRequest,
	WaitForJobsOptions,
	WaitForJobsResult,
} from './types.ts';
