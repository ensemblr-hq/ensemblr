import type { AgentProviderId } from '@/shared/agent-provider';
import type {
	AgentExecutablePathSnapshotWire,
	AgentProviderCheckWire,
	AgentProviderReadinessWire,
} from '@/shared/ipc/contracts/agent-provider';

/**
 * Where each runtime's binary is reported to live. Homebrew's prefix on Apple
 * silicon, which is where a reader following the install guide would find it.
 */
const EXECUTABLE_PATHS: Record<AgentProviderId, string> = {
	claude: '/opt/homebrew/bin/claude',
	pi: '/opt/homebrew/bin/pi',
};

/** Version each runtime reports, recent enough to look current in a shot. */
const VERSIONS: Record<AgentProviderId, string> = {
	claude: '2.1.251',
	pi: '0.14.2',
};

/**
 * Builds one passing readiness check.
 * @param id - Stable per-provider check id.
 * @param label - Row label as the Providers page renders it.
 * @param detail - Supporting line under the label.
 * @returns A check reporting success with no remediation offered.
 */
function passing(
	id: string,
	label: string,
	detail: string,
): AgentProviderCheckWire {
	return {
		detail,
		id,
		label,
		logs: null,
		remediations: [],
		status: 'success',
	};
}

/**
 * Reports a runtime as installed, authenticated, and answering.
 *
 * Demo mode probes no machine, so without this the Providers page renders the
 * bridge's no-op as an "Ensemblr could not probe the executable" failure — a
 * broken-looking screen on a page whose whole subject is that both runtimes are
 * healthy.
 * @param provider - Runtime being described.
 * @param updatedAt - The scenario's frozen clock.
 * @returns A readiness snapshot with every check passing.
 */
export function healthyReadiness(
	provider: AgentProviderId,
	updatedAt: string,
): AgentProviderReadinessWire {
	const executablePath = EXECUTABLE_PATHS[provider];
	const version = VERSIONS[provider];
	const isClaude = provider === 'claude';

	return {
		account: isClaude
			? {
					apiProvider: null,
					email: 'you@example.com',
					organization: 'Example Org',
					subscriptionType: 'Max',
					tokenSource: 'oauth',
				}
			: null,
		checks: [
			passing('executable', 'Executable', executablePath),
			passing('version', 'Version', version),
			...(isClaude
				? [passing('auth', 'Authentication', 'Signed in — Max plan')]
				: [passing('rpc-smoke', 'RPC handshake', 'Responded in 41ms')]),
		],
		executablePath,
		executableSource: 'path',
		provider,
		status: 'success',
		updatedAt,
		usage: null,
		version,
	};
}

/**
 * Reports no user override, so the executable field shows the discovered binary
 * rather than presenting a configured path as one the user typed.
 * @param provider - Runtime being described.
 * @returns The override snapshot the executable field hydrates from.
 */
export function discoveredExecutable(
	provider: AgentProviderId,
): AgentExecutablePathSnapshotWire {
	return {
		error: null,
		overridePath: null,
		provider,
		resolvedPath: EXECUTABLE_PATHS[provider],
		source: 'path',
		status: 'ok',
	};
}
