import {
	type AccountInfo,
	type McpServerStatus,
	query,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { getAgentProviderDescriptor } from '../../shared/agent-provider.ts';
import type {
	AgentProviderAccountWire,
	AgentProviderCheckWire,
	AgentProviderReadinessWire,
	SetupRemediationWire,
} from '../../shared/ipc/contracts/agent-provider';
import type {
	LocalCommandResult,
	LocalCommandService,
} from '../commands/local-command';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { createCommandLogs } from '../setup/index.ts';
import type {
	AgentExecutableResolution,
	AgentProviderExecutableService,
	AgentProviderReadinessProbe,
} from './agent-provider-types.ts';
import {
	createRetryRemediation,
	toExecutableSource,
} from './agent-provider-types.ts';
import type { ClaudeExecutableResolution } from './claude-executable.ts';

const CLAUDE_DESCRIPTOR = getAgentProviderDescriptor('claude');
const DEFAULT_VERSION_TIMEOUT_MS = 5000;

/**
 * How long the throwaway session gets to report the account and MCP roster
 * before the probe aborts it. Generous enough for a cold `claude` start on a
 * loaded machine, short enough that the Providers page never spins forever when
 * the runtime wedges mid-negotiation.
 */
const DEFAULT_SESSION_TIMEOUT_MS = 20_000;
const MS_PER_SECOND = 1000;
const VERSION_MAX_OUTPUT_BYTES = 4096;

/** The retry action every Claude check offers. */
const RETRY_REMEDIATION = createRetryRemediation(CLAUDE_DESCRIPTOR);

/** Sentinel {@link raceDeadline} resolves to when the deadline wins the race. */
const DEADLINE_EXCEEDED = Symbol('claude-session-deadline');

/**
 * Official native installer for Claude Code on macOS, Linux and WSL
 * (code.claude.com/docs/en/setup). Offered as a `run-command` remediation,
 * which the Providers page copies to the clipboard and never executes.
 */
const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';
const CLAUDE_SETUP_DOCS_URL = 'https://code.claude.com/docs/en/setup';

/**
 * Detail every "no binary" check repeats, so the executable, version and auth
 * rows all name the same single cause instead of three unrelated failures.
 */
const NO_EXECUTABLE_DETAIL = `No ${CLAUDE_DESCRIPTOR.executableCommand} executable was found on your PATH. Ensemblr does not ship ${CLAUDE_DESCRIPTOR.label}: install it, run ${CLAUDE_DESCRIPTOR.loginCommand ?? 'its login command'}, then re-run these checks.`;

/**
 * Permission mode the readiness probe runs its throwaway session under.
 *
 * This is deliberately NOT the terminal harness's `--dangerously-skip-permissions`
 * (see `HARNESS_REGISTRY` in `src/shared/agents.ts`): that flag is a product
 * decision scoped to the PTY tab, and first-class Claude must never inherit it.
 * A probe only reads capabilities, so `plan` keeps the child unable to touch
 * anything at all.
 */
const READINESS_PERMISSION_MODE = 'plan' as const;

/** Options for {@link createClaudeReadinessProbe}. */
export interface CreateClaudeReadinessProbeOptions {
	executableService: AgentProviderExecutableService;
	localCommandService: LocalCommandService;
	now?: () => Date;
	/** Injection seam for tests; defaults to the SDK's own `query`. */
	queryFn?: typeof query;
	/** Resolves the login-shell env so a Finder-launched app still finds `claude`. */
	resolveBaseEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	sessionTimeoutMs?: number;
	versionTimeoutMs?: number;
}

/** What a single short-lived `query()` reports about the signed-in runtime. */
interface ClaudeSessionProbeResult {
	account: AccountInfo | null;
	error: string | null;
	mcpServers: readonly McpServerStatus[];
}

/**
 * Builds Claude Code's readiness probe: resolve the executable, probe its
 * version, then open one short-lived `query()` to read the signed-in account
 * and the MCP server roster before closing it again.
 *
 * Concurrent calls share one run. The Providers page, its retry button, and
 * setup diagnostics all ask for readiness independently, and each spawned run
 * costs a `claude` child process — deduplicating here means N callers wait on
 * one child instead of N. Cleared on settle so a later call re-probes.
 * @param options - Executable service, command runner, and test seams.
 * @returns The Claude {@link AgentProviderReadinessProbe}.
 */
export function createClaudeReadinessProbe({
	executableService,
	localCommandService,
	now = () => new Date(),
	queryFn = query,
	resolveBaseEnv = () => process.env,
	sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
	versionTimeoutMs = DEFAULT_VERSION_TIMEOUT_MS,
}: CreateClaudeReadinessProbeOptions): AgentProviderReadinessProbe {
	let inFlightProbe: Promise<AgentProviderReadinessWire> | null = null;

	return {
		probe: () => {
			inFlightProbe ??= runClaudeProbe({
				executableService,
				localCommandService,
				now,
				queryFn,
				resolveBaseEnv,
				sessionTimeoutMs,
				versionTimeoutMs,
			}).finally(() => {
				inFlightProbe = null;
			});

			return inFlightProbe;
		},
		provider: CLAUDE_DESCRIPTOR.id,
	};
}

/**
 * Runs one full readiness pass: resolve the executable, then probe its version
 * and open the session concurrently. Neither probe reads the other's result, and
 * both spawn their own short-lived child, so racing them keeps the Providers
 * page waiting on the slower one rather than on their sum.
 * @param input - Resolved dependencies and timeouts for this pass.
 * @returns The readiness snapshot for the wire.
 */
async function runClaudeProbe({
	executableService,
	localCommandService,
	now,
	queryFn,
	resolveBaseEnv,
	sessionTimeoutMs,
	versionTimeoutMs,
}: {
	executableService: AgentProviderExecutableService;
	localCommandService: LocalCommandService;
	now: () => Date;
	queryFn: typeof query;
	resolveBaseEnv: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	sessionTimeoutMs: number;
	versionTimeoutMs: number;
}): Promise<AgentProviderReadinessWire> {
	const executable = await executableService.getSnapshot();
	const [versionResult, session] = await Promise.all([
		runVersionProbe({ executable, localCommandService, versionTimeoutMs }),
		probeClaudeSession({
			executablePath: executable.path,
			queryFn,
			resolveBaseEnv,
			sessionTimeoutMs,
		}),
	]);
	const checks = [
		createExecutableCheck(executable),
		createVersionCheck(executable, versionResult),
		createAuthCheck(executable, session),
		createMcpCheck(session),
	];

	return {
		account: toAccountWire(session.account),
		checks,
		executablePath: executable.path || null,
		executableSource: toExecutableSource(executable),
		provider: CLAUDE_DESCRIPTOR.id,
		status: checks.some((check) => check.status === 'failure')
			? 'failure'
			: 'success',
		updatedAt: now().toISOString(),
		version: readVersion(versionResult),
	} satisfies AgentProviderReadinessWire;
}

/**
 * Runs `<claude> --version` through the shared command service, mirroring the
 * GitHub CLI setup check. Skipped when nothing resolved, because there is no
 * path to invoke.
 * @param input - Resolved executable, command runner, and timeout.
 * @returns The command result, or `null` when there was nothing to run.
 */
async function runVersionProbe({
	executable,
	localCommandService,
	versionTimeoutMs,
}: {
	executable: AgentExecutableResolution;
	localCommandService: LocalCommandService;
	versionTimeoutMs: number;
}): Promise<LocalCommandResult | null> {
	if (!executable.path) {
		return null;
	}

	return localCommandService.run({
		args: ['--version'],
		command: executable.path,
		maxOutputBytes: VERSION_MAX_OUTPUT_BYTES,
		timeoutMs: versionTimeoutMs,
	});
}

/**
 * Opens one throwaway `query()` and asks it who is signed in and how its MCP
 * servers are doing. Never prompts, and always closes the child. With no
 * executable resolved the SDK would spawn a binary that does not exist, so the
 * probe reports the not-found failure instead of starting one.
 *
 * A resolved binary can still start and then hang — a corrupt install, a stuck
 * Keychain prompt, a stalled identity check — so the capability reads run under
 * a deadline. When it elapses the probe aborts the controller the SDK owns and
 * returns a normal failure, rather than awaiting a promise that never settles
 * and leaking the child.
 * @param input - Executable path, the query seam, the env resolver, and the deadline.
 * @returns The account and MCP roster, or the failure that prevented reading them.
 */
async function probeClaudeSession({
	executablePath,
	queryFn,
	resolveBaseEnv,
	sessionTimeoutMs,
}: {
	executablePath: string;
	queryFn: typeof query;
	resolveBaseEnv: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	sessionTimeoutMs: number;
}): Promise<ClaudeSessionProbeResult> {
	if (!executablePath) {
		return { account: null, error: NO_EXECUTABLE_DETAIL, mcpServers: [] };
	}

	const baseEnv = await resolveBaseEnv();
	const prompts = createIdlePromptStream();
	const abortController = new AbortController();
	let session: ReturnType<typeof query> | null = null;

	try {
		session = queryFn({
			options: {
				abortController,
				env: stripLaunchContextEnv({ ...baseEnv }),
				pathToClaudeCodeExecutable: executablePath,
				permissionMode: READINESS_PERMISSION_MODE,
			},
			prompt: prompts.stream,
		});

		return await readSessionCapabilities({
			abortController,
			session,
			sessionTimeoutMs,
		});
	} catch (cause) {
		return {
			account: null,
			error: cause instanceof Error ? cause.message : String(cause),
			mcpServers: [],
		};
	} finally {
		prompts.close();
		session?.close();
	}
}

/**
 * Reads the session's account and MCP roster under a deadline. When the
 * deadline wins, the abort controller the SDK owns is signalled so the child is
 * torn down instead of left negotiating behind an await nobody can cancel.
 * @param input - The open session, the controller aborting it, and the deadline.
 * @returns The capabilities, or the timeout reported as a normal failure.
 */
async function readSessionCapabilities({
	abortController,
	session,
	sessionTimeoutMs,
}: {
	abortController: AbortController;
	session: ReturnType<typeof query>;
	sessionTimeoutMs: number;
}): Promise<ClaudeSessionProbeResult> {
	const capabilities = await raceDeadline(
		Promise.all([session.accountInfo(), session.mcpServerStatus()]),
		sessionTimeoutMs,
	);

	if (capabilities === DEADLINE_EXCEEDED) {
		abortController.abort();

		return {
			account: null,
			error: describeSessionTimeout(sessionTimeoutMs),
			mcpServers: [],
		};
	}

	const [account, mcpServers] = capabilities;

	return { account, error: null, mcpServers };
}

/**
 * Races work against a deadline. `Promise.race` keeps its own handler attached
 * to the loser, so a late rejection from the abandoned work is never unhandled.
 * @param work - Promise to await.
 * @param deadlineMs - How long `work` gets before the deadline wins.
 * @returns The work's value, or {@link DEADLINE_EXCEEDED} when time ran out.
 */
async function raceDeadline<T>(
	work: Promise<T>,
	deadlineMs: number,
): Promise<T | typeof DEADLINE_EXCEEDED> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			work,
			new Promise<typeof DEADLINE_EXCEEDED>((resolve) => {
				timer = setTimeout(() => resolve(DEADLINE_EXCEEDED), deadlineMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Detail for a runtime that started but never answered. Names the deadline so a
 * wedged install reads differently from a signed-out one, and points at the
 * terminal run that clears a pending login or Keychain prompt.
 * @param sessionTimeoutMs - Deadline that elapsed.
 * @returns The failure detail the auth check renders.
 */
function describeSessionTimeout(sessionTimeoutMs: number): string {
	const seconds = Math.max(1, Math.round(sessionTimeoutMs / MS_PER_SECOND));

	return `${CLAUDE_DESCRIPTOR.label} started but did not answer within ${seconds}s. Run ${CLAUDE_DESCRIPTOR.executableCommand} in a terminal to clear any pending login or Keychain prompt, then re-run these checks.`;
}

/**
 * A prompt stream the probe never pushes into. Streaming-input mode is what
 * exposes `accountInfo()` and `mcpServerStatus()`, so the child still needs an
 * input iterable even though the probe runs no turn; closing it ends the
 * generator instead of leaving it pending after the probe returns.
 * @returns The idle stream plus the function that ends it.
 */
function createIdlePromptStream(): {
	close: () => void;
	stream: AsyncIterable<SDKUserMessage>;
} {
	let release: () => void = () => undefined;
	const ended = new Promise<void>((resolve) => {
		release = resolve;
	});

	return {
		close: () => release(),
		stream: {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					await ended;
					return { done: true, value: undefined };
				},
			}),
		},
	};
}

/**
 * Reads the reason a configured path was rejected outright, when the resolver
 * supplied one. A rejected path never reached the filesystem, so "could not be
 * run" would misdescribe it — the value itself was not a usable path.
 * @param executable - The resolution the probe is reporting on.
 * @returns The rejection message, or null when the path failed for another reason.
 */
function describeRejectedExecutable(
	executable: AgentExecutableResolution,
): string | null {
	const message = (executable as ClaudeExecutableResolution).message;
	return typeof message === 'string' && message.length > 0 ? message : null;
}

/** Builds the check reporting which `claude` binary a session would launch. */
function createExecutableCheck(
	executable: AgentExecutableResolution,
): AgentProviderCheckWire {
	const source = toExecutableSource(executable);

	if (source === 'missing') {
		return {
			detail:
				describeRejectedExecutable(executable) ??
				(executable.setting
					? `The configured ${CLAUDE_DESCRIPTOR.label} executable could not be run. Clear the override to fall back to the ${CLAUDE_DESCRIPTOR.executableCommand} on your PATH, or pick a runnable binary.`
					: NO_EXECUTABLE_DETAIL),
			id: 'executable',
			label: `${CLAUDE_DESCRIPTOR.label} executable`,
			logs: null,
			remediations: [
				...(executable.setting ? [] : createInstallRemediations()),
				{
					id: 'select-claude-executable',
					kind: 'select-path',
					label: `Select ${CLAUDE_DESCRIPTOR.label} executable`,
					target: CLAUDE_DESCRIPTOR.executableSettingKey,
				},
				RETRY_REMEDIATION,
			],
			status: 'failure',
		};
	}

	return {
		detail: `${source === 'configured' ? 'Configured override' : 'Found on PATH'}: ${executable.path}.`,
		id: 'executable',
		label: `${CLAUDE_DESCRIPTOR.label} executable`,
		logs: null,
		remediations: [RETRY_REMEDIATION],
		status: 'success',
	};
}

/** Builds the check reporting the runtime's reported version. */
function createVersionCheck(
	executable: AgentExecutableResolution,
	result: LocalCommandResult | null,
): AgentProviderCheckWire {
	if (!result) {
		return {
			detail: `There is no ${CLAUDE_DESCRIPTOR.executableCommand} binary to version-probe. ${NO_EXECUTABLE_DETAIL}`,
			id: 'version',
			label: 'Version',
			logs: null,
			remediations: [...createInstallRemediations(), RETRY_REMEDIATION],
			status: 'failure',
		};
	}

	const logs = createCommandLogs(result);

	if (result.status !== 'success') {
		return {
			detail: `${executable.path} --version failed: ${result.failure?.message ?? 'Unknown command failure.'}`,
			id: 'version',
			label: 'Version',
			logs,
			remediations: [RETRY_REMEDIATION],
			status: 'failure',
		};
	}

	return {
		detail: readVersion(result),
		id: 'version',
		label: 'Version',
		logs,
		remediations: [RETRY_REMEDIATION],
		status: 'success',
	};
}

/**
 * Builds the check reporting whether the runtime is signed in. With no binary
 * installed there is nothing to sign in to, so the row leads with the install
 * step rather than a login command the user cannot run yet.
 */
function createAuthCheck(
	executable: AgentExecutableResolution,
	session: ClaudeSessionProbeResult,
): AgentProviderCheckWire {
	if (isAuthenticated(session.account)) {
		return {
			detail: describeAccount(session.account),
			id: 'auth',
			label: 'Authentication',
			logs: null,
			remediations: [RETRY_REMEDIATION],
			status: 'success',
		};
	}

	return {
		detail:
			session.error ??
			`${CLAUDE_DESCRIPTOR.label} is installed but not signed in.`,
		id: 'auth',
		label: 'Authentication',
		logs: null,
		remediations: [
			...(executable.path ? [] : createInstallRemediations()),
			...createLoginRemediations(),
			RETRY_REMEDIATION,
		],
		status: 'failure',
	};
}

/** Builds the check reporting the runtime's MCP server roster. */
function createMcpCheck(
	session: ClaudeSessionProbeResult,
): AgentProviderCheckWire {
	if (session.error) {
		return {
			detail:
				'MCP servers could not be listed because the runtime did not report them.',
			id: 'mcp',
			label: 'MCP servers',
			logs: null,
			remediations: [RETRY_REMEDIATION],
			status: 'warning',
		};
	}

	const unhealthy = session.mcpServers.filter(
		(server) => server.status === 'failed' || server.status === 'needs-auth',
	);

	if (unhealthy.length > 0) {
		return {
			detail: unhealthy
				.map((server) => `${server.name}: ${server.status}`)
				.join(', '),
			id: 'mcp',
			label: 'MCP servers',
			logs: null,
			remediations: [RETRY_REMEDIATION],
			status: 'warning',
		};
	}

	return {
		detail:
			session.mcpServers.length === 0
				? 'No MCP servers are configured.'
				: `${session.mcpServers.length} MCP server(s) connected.`,
		id: 'mcp',
		label: 'MCP servers',
		logs: null,
		remediations: [RETRY_REMEDIATION],
		status: 'success',
	};
}

/**
 * The install pair every "no binary" check offers: the official native
 * installer to copy, and the setup docs for anyone who wants the npm route or
 * another platform. `run-command` copies rather than executes, matching the
 * login remediation's copy-never-execute policy.
 * @returns The install remediations, in the order the page renders them.
 */
function createInstallRemediations(): readonly SetupRemediationWire[] {
	return [
		{
			command: CLAUDE_INSTALL_COMMAND,
			id: 'install-claude-code',
			kind: 'run-command',
			label: `Copy the ${CLAUDE_DESCRIPTOR.label} install command`,
		},
		{
			id: 'open-claude-setup-docs',
			kind: 'open-external',
			label: `Open ${CLAUDE_DESCRIPTOR.label} setup docs`,
			target: CLAUDE_SETUP_DOCS_URL,
		},
	];
}

/**
 * The sign-in action, when the runtime declares a login command.
 * @returns The `run-command` login remediation, or nothing when there is none.
 */
function createLoginRemediations(): readonly SetupRemediationWire[] {
	if (!CLAUDE_DESCRIPTOR.loginCommand) {
		return [];
	}

	return [
		{
			command: CLAUDE_DESCRIPTOR.loginCommand,
			id: 'run-claude-login',
			kind: 'run-command',
			label: `Run ${CLAUDE_DESCRIPTOR.loginCommand}`,
		},
	];
}

/**
 * True when the runtime reported an identity. Third-party backends (Bedrock,
 * Vertex) authenticate outside the CLI and report only `apiProvider`, which
 * still counts as signed in.
 * @param account - Account the runtime reported, or `null` when it could not be read.
 * @returns Whether the runtime can make requests.
 */
function isAuthenticated(account: AccountInfo | null): account is AccountInfo {
	if (!account) {
		return false;
	}

	return Boolean(
		account.email ??
			account.organization ??
			account.tokenSource ??
			account.apiKeySource ??
			(account.apiProvider && account.apiProvider !== 'firstParty'),
	);
}

/** Renders the signed-in identity as a one-line detail string. */
function describeAccount(account: AccountInfo): string {
	const identity =
		account.email ?? account.organization ?? account.apiProvider ?? 'Signed in';
	const plan = account.subscriptionType ? ` (${account.subscriptionType})` : '';

	return `${identity}${plan}.`;
}

/** Projects the SDK's account shape onto the wire, nulling absent fields. */
function toAccountWire(
	account: AccountInfo | null,
): AgentProviderAccountWire | null {
	if (!account) {
		return null;
	}

	return {
		apiProvider: account.apiProvider ?? null,
		email: account.email ?? null,
		organization: account.organization ?? null,
		subscriptionType: account.subscriptionType ?? null,
		tokenSource: account.tokenSource ?? account.apiKeySource ?? null,
	};
}

/** Reads the first non-blank output line of a `--version` run. */
function readVersion(result: LocalCommandResult | null): string | null {
	if (result?.status !== 'success') {
		return null;
	}

	const line = [result.stdout, result.stderr]
		.flatMap((output) => output.split(/\r?\n/))
		.map((part) => part.trim())
		.find(Boolean);

	return line ?? null;
}
