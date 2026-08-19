/** How long one PTY is given to exit after being killed before teardown moves on. */
const TERMINAL_EXIT_TIMEOUT_MS = 5_000;

/** How long one agent session is given to abort before teardown moves on. */
const AGENT_SESSION_STOP_TIMEOUT_MS = 10_000;

/** What a bounded teardown step reported back. */
interface DeadlineOutcome {
	/** The step's error message, or null when it did not fail. */
	failure: string | null;
	/** True when the deadline elapsed before the step settled. */
	timedOut: boolean;
}

/**
 * What a teardown wound down, and what refused to. Callers turn `failures` into
 * their own warning diagnostics — the messages are English detail lines, not
 * codes.
 */
export interface WorkspaceTeardownReport {
	agentSessionsStopped: number;
	failures: string[];
	terminalsKilled: number;
}

/**
 * Ports the teardown reaches. Every one is supplied by the composition root;
 * the services under test pass fakes.
 */
export interface WorkspaceTeardownPorts {
	killTerminal: (terminalId: string) => void;
	listAgentSessionIds: (workspaceId: string) => readonly string[];
	listTerminalIds: (workspaceId: string) => readonly string[];
	releaseAgentControl: (sessionId: string) => void;
	stopAgentSession: (sessionId: string) => Promise<void>;
	stopWatchingFiles: (workspaceCwd: string) => void;
	waitForTerminalExit: (
		terminalId: string,
		timeoutMs: number,
	) => Promise<boolean>;
}

/** Public surface of the pre-removal teardown. */
export interface WorkspaceTeardownService {
	teardown: (input: {
		workspaceId: string;
		workspacePath: string;
	}) => Promise<WorkspaceTeardownReport>;
}

/**
 * Builds the service that detaches everything still holding a workspace open
 * before its worktree and row are removed: agent runtime children, PTYs,
 * agent-control bearer tokens, and the recursive file watcher.
 *
 * Without it those subsystems watch the directory vanish underneath them and
 * keep streaming — the terminal-output and agent-event broadcasts are
 * unthrottled, so a dev server reacting to its own tree being unlinked floods
 * the renderer for as long as the child lives, which is until the app is
 * killed. Nothing here fails the removal, and nothing here can hold it open
 * either: every wait a subsystem could stall on is deadlined, and a child that
 * will not die is reported as a warning while the removal proceeds.
 * @param ports - The subsystem ports to wind down through
 * @returns A teardown service the delete and archive paths call before removing anything
 */
export function createWorkspaceTeardownService(
	ports: WorkspaceTeardownPorts,
): WorkspaceTeardownService {
	return {
		teardown: async ({ workspaceId, workspacePath }) => {
			const failures: string[] = [];

			// Sequential on purpose, not an oversight: an agent still running can
			// open a terminal through agent control, so listing the PTYs before the
			// runtimes are down would miss any it starts in between. Both phases are
			// individually deadlined, so the ordering costs a bounded wait rather
			// than an open-ended one.
			const agentSessionsStopped = await stopAgentSessions({
				failures,
				ports,
				workspaceId,
			});

			const terminalsKilled = await killTerminals({
				failures,
				ports,
				workspaceId,
			});

			try {
				ports.stopWatchingFiles(workspacePath);
			} catch (error) {
				failures.push(
					`Could not stop watching ${workspacePath}: ${errorMessage(error)}`,
				);
			}

			return { agentSessionsStopped, failures, terminalsKilled };
		},
	};
}

/**
 * Stops every agent session of a workspace and releases its control origin.
 * Sessions are stopped concurrently — each `stopAgentSession` already cascades
 * to the sub-agents it spawned, and one wedged runtime must not delay the rest.
 * Each stop is deadlined: the Pi adapter signals and returns, but the Claude one
 * awaits the SDK's `interrupt()`, so an unbounded wait here would hang the whole
 * removal on a runtime that never answers.
 * @param input - Diagnostics sink, the ports, and the workspace being removed
 * @returns How many sessions were stopped without error
 */
async function stopAgentSessions({
	failures,
	ports,
	workspaceId,
}: {
	failures: string[];
	ports: WorkspaceTeardownPorts;
	workspaceId: string;
}): Promise<number> {
	const sessionIds = readSessionIds({ failures, ports, workspaceId });
	const outcomes = await Promise.all(
		sessionIds.map(async (sessionId) => {
			const outcome = await runWithDeadline(
				() => ports.stopAgentSession(sessionId),
				AGENT_SESSION_STOP_TIMEOUT_MS,
			);

			if (outcome.timedOut) {
				failures.push(
					`Agent session ${sessionId} did not stop within ${AGENT_SESSION_STOP_TIMEOUT_MS}ms; its runtime child may still be running.`,
				);
				return false;
			}

			if (outcome.failure !== null) {
				failures.push(
					`Could not stop agent session ${sessionId}: ${outcome.failure}`,
				);
				return false;
			}

			return true;
		}),
	);

	// Released after the stop attempts, not before: a session that refuses to
	// stop still holds a live child, and revoking its token first would leave
	// that child making control calls that fail rather than calls that work.
	for (const sessionId of sessionIds) {
		try {
			ports.releaseAgentControl(sessionId);
		} catch (error) {
			failures.push(
				`Could not release agent control for ${sessionId}: ${errorMessage(error)}`,
			);
		}
	}

	return outcomes.filter(Boolean).length;
}

/**
 * Kills every PTY of a workspace and waits, with a cap, for each child to exit.
 * @param input - Diagnostics sink, the ports, and the workspace being removed
 * @returns How many terminals were confirmed exited
 */
async function killTerminals({
	failures,
	ports,
	workspaceId,
}: {
	failures: string[];
	ports: WorkspaceTeardownPorts;
	workspaceId: string;
}): Promise<number> {
	const terminalIds = readTerminalIds({ failures, ports, workspaceId });
	const outcomes = await Promise.all(
		terminalIds.map(async (terminalId) => {
			try {
				ports.killTerminal(terminalId);
			} catch (error) {
				failures.push(
					`Could not stop terminal ${terminalId}: ${errorMessage(error)}`,
				);
				return false;
			}

			const exited = await ports.waitForTerminalExit(
				terminalId,
				TERMINAL_EXIT_TIMEOUT_MS,
			);
			if (!exited) {
				failures.push(
					`Terminal ${terminalId} did not exit within ${TERMINAL_EXIT_TIMEOUT_MS}ms; its output may continue.`,
				);
			}
			return exited;
		}),
	);

	return outcomes.filter(Boolean).length;
}

/**
 * Reads a workspace's agent session ids, treating a listing failure as nothing
 * to stop so the removal is never blocked by it.
 * @param input - Diagnostics sink, the ports, and the workspace being removed
 * @returns The session ids, or an empty list when listing failed
 */
function readSessionIds({
	failures,
	ports,
	workspaceId,
}: {
	failures: string[];
	ports: WorkspaceTeardownPorts;
	workspaceId: string;
}): readonly string[] {
	try {
		return ports.listAgentSessionIds(workspaceId);
	} catch (error) {
		failures.push(`Could not list agent sessions: ${errorMessage(error)}`);
		return [];
	}
}

/**
 * Reads a workspace's terminal ids, treating a listing failure as nothing to
 * kill so the removal is never blocked by it.
 * @param input - Diagnostics sink, the ports, and the workspace being removed
 * @returns The terminal ids, or an empty list when listing failed
 */
function readTerminalIds({
	failures,
	ports,
	workspaceId,
}: {
	failures: string[];
	ports: WorkspaceTeardownPorts;
	workspaceId: string;
}): readonly string[] {
	try {
		return ports.listTerminalIds(workspaceId);
	} catch (error) {
		failures.push(`Could not list terminals: ${errorMessage(error)}`);
		return [];
	}
}

/**
 * Runs one teardown step against a deadline, so a subsystem that never answers
 * costs a bounded wait rather than holding the removal open forever. A rejection
 * arriving after the deadline is already handled, so it cannot surface as an
 * unhandled rejection once the race is over.
 * @param start - Begins the step; a synchronous throw is caught like a rejection
 * @param timeoutMs - How long to wait before giving up on it
 * @returns Why the step failed, or that the deadline elapsed first
 */
async function runWithDeadline(
	start: () => Promise<void>,
	timeoutMs: number,
): Promise<DeadlineOutcome> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<DeadlineOutcome>((resolve) => {
		timer = setTimeout(() => {
			resolve({ failure: null, timedOut: true });
		}, timeoutMs);
	});
	const settled = Promise.resolve()
		.then(start)
		.then(
			(): DeadlineOutcome => ({ failure: null, timedOut: false }),
			(error: unknown): DeadlineOutcome => ({
				failure: errorMessage(error),
				timedOut: false,
			}),
		);

	try {
		return await Promise.race([settled, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Reads a thrown value's message.
 * @param error - The thrown value
 * @returns Its message, or a generic sentence when it is not an `Error`
 */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'an unexpected error';
}
