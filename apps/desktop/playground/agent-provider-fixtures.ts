import type { AgentProviderId } from '@/shared/agent-provider';
import type {
	AgentExecutablePathSnapshotWire,
	AgentProviderReadinessWire,
	ListAgentProviderMcpServersResult,
	OpenAgentProviderSettingsFileResult,
} from '@/shared/ipc/contracts/agent-provider';
import type { ListWorkspaceOpenTargetsResult } from '@/shared/ipc/contracts/open-target';

const PROBED_AT = '2026-08-07T09:12:44.000Z';

// Scene-local switch, not app state: the bridge handler is registered once at
// boot, so the signed-out variant has to be reachable without re-installing it.
let signedIn = true;

/**
 * Whether the fixture provider currently reports working credentials.
 * @returns True when the readiness fixtures describe a signed-in Claude Code.
 */
export function isFixtureProviderSignedIn(): boolean {
	return signedIn;
}

/**
 * Flips the fixture between a signed-in and a signed-out Claude Code so the
 * scene can show the "Connected" headline and the `claude /login` copy control.
 * @param next - Whether the provider should report working credentials.
 */
export function setFixtureProviderSignedIn(next: boolean): void {
	signedIn = next;
}

/**
 * Readiness for a signed-in Claude Code, with one warning check so the scene
 * exercises the remediation row on an otherwise healthy provider.
 * @returns The connected Claude readiness snapshot.
 */
function connectedClaudeReadiness(): AgentProviderReadinessWire {
	return {
		account: {
			apiProvider: 'anthropic',
			email: 'dev@example.com',
			organization: 'Example Org',
			subscriptionType: 'Max 20x',
			tokenSource: 'keychain',
		},
		checks: [
			{
				detail: '/opt/homebrew/bin/claude',
				id: 'executable',
				label: 'Executable',
				logs: null,
				remediations: [],
				status: 'success',
			},
			{
				detail: 'claude 2.1.220',
				id: 'version',
				label: 'Version',
				logs: [{ label: 'Command', text: 'claude --version' }],
				remediations: [],
				status: 'success',
			},
			{
				detail: 'Signed in through the macOS keychain.',
				id: 'auth',
				label: 'Authentication',
				logs: null,
				remediations: [],
				status: 'success',
			},
			{
				detail: '1 of 2 MCP servers failed to connect: ensemblr.',
				id: 'mcp',
				label: 'MCP servers',
				logs: [
					{ label: 'Command', text: 'claude mcp list' },
					{
						label: 'stderr',
						text: 'ensemblr: connection refused (127.0.0.1:7317)',
					},
				],
				remediations: [
					{
						command: 'claude mcp list',
						id: 'claude-mcp-list',
						kind: 'run-command',
						label: 'Copy claude mcp list',
					},
					{ id: 'claude-mcp-retry', kind: 'retry', label: 'Re-run checks' },
				],
				status: 'warning',
			},
		],
		executablePath: '/opt/homebrew/bin/claude',
		executableSource: 'path',
		provider: 'claude',
		status: 'success',
		updatedAt: PROBED_AT,
		usage: {
			available: true,
			limits: [
				{
					displayName: null,
					id: 'five_hour',
					resetsAt: '2026-08-07T14:00:00.000Z',
					utilization: 62,
				},
				{
					displayName: null,
					id: 'seven_day',
					resetsAt: '2026-08-11T09:00:00.000Z',
					utilization: 31,
				},
				{
					displayName: null,
					id: 'seven_day_opus',
					resetsAt: '2026-08-11T09:00:00.000Z',
					utilization: 88,
				},
				{
					displayName: 'Fable',
					id: 'Fable',
					resetsAt: '2026-08-11T09:00:00.000Z',
					utilization: null,
				},
			],
			subscriptionType: 'max',
		},
		version: '2.1.220',
	};
}

/**
 * Readiness for a Claude Code that resolved but has no usable credentials —
 * the state the `claude /login` copy control exists for.
 * @returns The signed-out Claude readiness snapshot.
 */
function signedOutClaudeReadiness(): AgentProviderReadinessWire {
	return {
		account: null,
		checks: [
			{
				detail: '/opt/homebrew/bin/claude',
				id: 'executable',
				label: 'Executable',
				logs: null,
				remediations: [],
				status: 'success',
			},
			{
				detail: 'No credentials found in the keychain or ANTHROPIC_API_KEY.',
				id: 'auth',
				label: 'Authentication',
				logs: [
					{ label: 'Command', text: 'claude --version' },
					{ label: 'stderr', text: 'Invalid API key · Please run /login' },
				],
				remediations: [
					{
						command: 'claude /login',
						id: 'claude-login',
						kind: 'run-command',
						label: 'Copy claude /login',
					},
					{
						id: 'claude-auth-docs',
						kind: 'open-external',
						label: 'Authentication docs',
						target: 'https://docs.claude.com/en/docs/claude-code/setup',
					},
				],
				status: 'failure',
			},
		],
		executablePath: '/opt/homebrew/bin/claude',
		executableSource: 'path',
		provider: 'claude',
		status: 'failure',
		updatedAt: PROBED_AT,
		usage: null,
		version: '2.1.220',
	};
}

/**
 * Readiness for a Pi whose RPC smoke test failed. Pi reports no account, which
 * is how the shared panel proves it is descriptor-driven rather than
 * Claude-shaped with Pi bolted on.
 * @returns The Pi readiness snapshot.
 */
function piReadiness(): AgentProviderReadinessWire {
	return {
		account: null,
		checks: [
			{
				detail: '/Users/dev/.local/bin/pi',
				id: 'executable',
				label: 'Executable',
				logs: null,
				remediations: [],
				status: 'success',
			},
			{
				detail: 'pi 0.42.1',
				id: 'version',
				label: 'Version',
				logs: null,
				remediations: [],
				status: 'success',
			},
			{
				detail: 'The RPC handshake timed out after 8s.',
				id: 'rpc-smoke',
				label: 'RPC smoke test',
				logs: [
					{ label: 'Command', text: 'pi --mode rpc' },
					{
						label: 'stderr',
						text: 'timed out waiting for the initialize response',
						truncated: true,
					},
				],
				remediations: [
					{ id: 'pi-rpc-retry', kind: 'retry', label: 'Re-run checks' },
					{
						id: 'pi-rpc-pick',
						kind: 'select-path',
						label: 'Choose executable',
					},
				],
				status: 'failure',
			},
		],
		executablePath: '/Users/dev/.local/bin/pi',
		executableSource: 'configured',
		provider: 'pi',
		status: 'failure',
		updatedAt: PROBED_AT,
		usage: null,
		version: '0.42.1',
	};
}

/**
 * Bridge stand-in for `listAgentProviderMcpServers`. Covers every tier a real
 * roster spans — plugin, user, project, and remote connector — plus each status
 * the panel renders differently.
 * @param payload - The `{ cwd, provider }` request from the roster query.
 * @returns The fixture roster for that provider.
 */
export function resolveFixtureAgentProviderMcpServers(
	payload: unknown,
): ListAgentProviderMcpServersResult {
	if (readBridgeProvider(payload) === 'pi') {
		return { error: null, servers: [] };
	}
	return {
		error: null,
		servers: [
			{
				error: null,
				name: 'plugin:playwright:playwright',
				status: 'connected',
			},
			{ error: null, name: 'nanobanana', status: 'connected' },
			{
				error: 'spawn npx ENOENT',
				name: '@21st-dev/magic',
				status: 'failed',
			},
			{ error: null, name: 'shadcn', status: 'connected' },
			{
				error: 'connection refused (127.0.0.1:7317)',
				name: 'fallow',
				status: 'failed',
			},
			{ error: null, name: 'claude.ai Linear', status: 'needs-auth' },
			{ error: null, name: 'claude.ai Notion', status: 'needs-auth' },
			{ error: null, name: 'claude.ai Figma', status: 'connected' },
			{ error: null, name: 'nocodb', status: 'pending' },
		],
	};
}

/**
 * Reads the provider id out of a bridge request.
 * @param payload - The request a renderer query passed to the bridge.
 * @returns The requested provider id, defaulting to Claude Code.
 */
function readBridgeProvider(payload: unknown): AgentProviderId {
	if (
		typeof payload === 'object' &&
		payload !== null &&
		'provider' in payload
	) {
		return payload.provider === 'pi' ? 'pi' : 'claude';
	}
	return 'claude';
}

/**
 * Bridge stand-in for `getAgentProviderReadiness`.
 * @param payload - The `{ provider }` request from the readiness query.
 * @returns The fixture readiness snapshot for that provider.
 */
export function resolveFixtureAgentProviderReadiness(
	payload: unknown,
): AgentProviderReadinessWire {
	if (readBridgeProvider(payload) === 'pi') {
		return piReadiness();
	}
	return signedIn ? connectedClaudeReadiness() : signedOutClaudeReadiness();
}

/**
 * Bridge stand-in for `getAgentProviderExecutablePath`.
 * @param payload - The `{ provider }` request from the executable-path query.
 * @returns The fixture executable snapshot for that provider.
 */
export function resolveFixtureAgentProviderExecutablePath(
	payload: unknown,
): AgentExecutablePathSnapshotWire {
	if (readBridgeProvider(payload) === 'pi') {
		return {
			error: null,
			overridePath: '/Users/dev/.local/bin/pi',
			provider: 'pi',
			resolvedPath: '/Users/dev/.local/bin/pi',
			source: 'sqlite',
			status: 'ok',
		};
	}
	return {
		error: null,
		overridePath: null,
		provider: 'claude',
		resolvedPath: '/opt/homebrew/bin/claude',
		source: 'path',
		status: 'ok',
	};
}

/**
 * Bridge stand-in for `openAgentProviderSettingsFile`. Nothing opens in a
 * browser; the handler exists so the split button gets a well-formed result
 * instead of the blanket `undefined` no-op.
 * @returns A successful open.
 */
export function resolveFixtureOpenProviderSettingsFile(): OpenAgentProviderSettingsFileResult {
	return { opened: true };
}

/**
 * Bridge stand-in for `listWorkspaceOpenTargets`, so the settings-file row can
 * render its real "Open in ⌄" split button instead of the disabled placeholder.
 * @returns Two editors plus the copy-path utility entry.
 */
export function resolveFixtureOpenTargets(): ListWorkspaceOpenTargetsResult {
	return {
		targets: [
			{
				behavior: 'launch-app',
				iconName: 'vscode-icons:file-type-vscode',
				id: 'vscode',
				installed: true,
				isPrimary: true,
				kind: 'editor',
				label: 'Visual Studio Code',
				numberShortcutLabel: '1',
			},
			{
				behavior: 'reveal-in-finder',
				iconName: 'lucide:folder',
				id: 'finder',
				installed: true,
				kind: 'file-manager',
				label: 'Finder',
				numberShortcutLabel: '2',
			},
			{
				behavior: 'copy-path',
				iconName: 'lucide:copy',
				id: 'copy-path',
				installed: true,
				kind: 'utility',
				label: 'Copy path',
				numberShortcutLabel: '3',
			},
		],
	};
}
