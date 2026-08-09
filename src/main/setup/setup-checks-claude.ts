import { getAgentProviderDescriptor } from '../../shared/agent-provider.ts';
import type { SetupRemediationAction } from '../../shared/ipc/contracts/setup';
import type { AgentExecutableResolution } from '../agent-providers/agent-provider-types.ts';
import {
	CLAUDE_INSTALL_COMMAND,
	CLAUDE_SETUP_DOCS_URL,
} from '../agent-providers/claude-executable.ts';
import {
	defineCheck,
	type SetupCheckProviderContext,
} from './setup-check-context.ts';

const CLAUDE_DESCRIPTOR = getAgentProviderDescriptor('claude');

/**
 * Resolves the `claude` binary a first-class Claude session would launch.
 * Deliberately narrower than the provider readiness probe, which also opens a
 * throwaway SDK session under a 20s deadline to read the account and MCP roster
 * — far too heavy for a boot check that polls.
 */
interface ClaudeExecutableProbe {
	getSnapshot: () => Promise<AgentExecutableResolution>;
}

/** Dependencies for the Claude executable setup check. */
interface ClaudeExecutableCheckDeps {
	claudeExecutableService: ClaudeExecutableProbe;
	context: SetupCheckProviderContext;
}

/**
 * Builds the snapshot for the Claude Code executable discovery check.
 *
 * Non-blocking on purpose: Ensemblr needs *an* agent runtime, not this one, so a
 * machine running only Pi must still roll up as ready. The onboarding wizard
 * applies the either-or gate across this check and `pi-executable`.
 */
export function getClaudeExecutableCheck({
	claudeExecutableService,
	context,
}: ClaudeExecutableCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: false,
		description: `Discovers the ${CLAUDE_DESCRIPTOR.label} executable a first-class Claude chat would launch, without starting one.`,
		group: 'claude',
		id: 'claude-executable',
		onError: (error) => ({
			detail:
				error instanceof Error
					? error.message
					: `Unknown ${CLAUDE_DESCRIPTOR.label} executable check error.`,
			remediationActions: createRemediationActions(null),
		}),
		run: async () => {
			const executable = await claudeExecutableService.getSnapshot();
			const isResolved = executable.status === 'ok' && Boolean(executable.path);

			return {
				detail: describeExecutable(executable),
				remediationActions: createRemediationActions(executable),
				status: isResolved ? 'success' : 'failure',
			};
		},
		title: `${CLAUDE_DESCRIPTOR.label} executable`,
	});

	return check(context);
}

/**
 * Renders the resolution as the one-line detail the check surfaces.
 * @param executable - Resolution reported by the executable service.
 * @returns The detail line, naming the resolved path or why nothing resolved.
 */
function describeExecutable(executable: AgentExecutableResolution): string {
	if (executable.status === 'ok' && executable.path) {
		return `${executable.setting ? 'Configured override' : 'Found on PATH'}: ${executable.path}.`;
	}

	if (executable.setting) {
		return `The configured ${CLAUDE_DESCRIPTOR.label} executable could not be run. Clear the override to fall back to the ${CLAUDE_DESCRIPTOR.executableCommand} on your PATH, or pick a runnable binary.`;
	}

	return `${CLAUDE_DESCRIPTOR.label} was not found in the shell-derived PATH. Ensemblr does not ship it: install ${CLAUDE_DESCRIPTOR.label}, then retry.`;
}

/**
 * Builds the actions offered on the check. The installer is dropped once an
 * override exists, because the problem is then the override rather than a
 * missing install.
 * @param executable - Resolution the actions apply to, or null after an error.
 * @returns The remediation actions, in the order surfaces render them.
 */
function createRemediationActions(
	executable: AgentExecutableResolution | null,
): SetupRemediationAction[] {
	return [
		...(executable?.setting ? [] : createInstallActions()),
		{
			id: 'select-claude-executable',
			kind: 'select-path',
			label: `Select ${CLAUDE_DESCRIPTOR.label} executable`,
			target: CLAUDE_DESCRIPTOR.executableSettingKey,
		},
		{
			id: 'retry-claude-executable',
			kind: 'retry',
			label: `Retry ${CLAUDE_DESCRIPTOR.label} executable check`,
		},
	];
}

/**
 * The install pair every "no binary" outcome offers: the official native
 * installer to copy, and the setup docs for the npm route or another platform.
 * `run-command` copies rather than executes.
 * @returns The install actions.
 */
function createInstallActions(): SetupRemediationAction[] {
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
