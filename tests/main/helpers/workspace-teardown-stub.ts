import type {
	WorkspaceTeardownReport,
	WorkspaceTeardownService,
} from '../../../src/main/repository/workspace-teardown.ts';
import type { TerminalScrollbackCapture } from '../../../src/main/terminal/terminal-output-file.ts';

/** A `WorkspaceTeardownService` double plus the calls it recorded. */
export interface WorkspaceTeardownStub extends WorkspaceTeardownService {
	/** Every `teardown` call, in order, so a test can assert it ran and with what. */
	calls: { workspaceId: string; workspacePath: string }[];
}

/**
 * Builds a `WorkspaceTeardownService` test double that records its calls and
 * reports nothing wound down. The single source of truth for the stub shape
 * across tests/main/*; pass `failures` to exercise the warning-diagnostic path.
 * @param failures - Failure messages the stub reports back on every call
 * @param scrollbacks - Terminal captures the stub reports as read from memory
 * @returns The stub, with the recorded calls exposed on `calls`
 */
export function buildWorkspaceTeardownStub(
	failures: string[] = [],
	scrollbacks: readonly TerminalScrollbackCapture[] = [],
): WorkspaceTeardownStub {
	const calls: { workspaceId: string; workspacePath: string }[] = [];
	const report: WorkspaceTeardownReport = {
		agentSessionsStopped: 0,
		failures,
		scrollbacks,
		terminalsKilled: 0,
	};

	return {
		calls,
		teardown: async (input) => {
			calls.push({
				workspaceId: input.workspaceId,
				workspacePath: input.workspacePath,
			});
			return report;
		},
	};
}
