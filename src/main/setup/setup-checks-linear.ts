import type { LinearConnectionSnapshot } from '../../shared/ipc/contracts/linear';
import type {
	SetupCheckStatus,
	SetupRemediationAction,
} from '../../shared/ipc/contracts/setup';
import type { LinearAuthService } from '../linear';
import {
	defineCheck,
	type SetupCheckProviderContext,
} from './setup-check-context.ts';

interface LinearCheckDeps {
	context: SetupCheckProviderContext;
	linearAuthService: LinearAuthService;
}

const LINEAR_REMEDIATION_ACTIONS: SetupRemediationAction[] = [
	{
		id: 'open-linear-settings',
		kind: 'open-settings',
		label: 'Open integration settings',
		target: 'linear',
	},
	{
		id: 'retry-linear',
		kind: 'retry',
		label: 'Retry Linear check',
	},
];

/** Builds the snapshot for the optional Linear OAuth connection check. */
export function getLinearConnectionCheck(deps: LinearCheckDeps) {
	const check = defineCheck<SetupCheckProviderContext>({
		blocking: false,
		description:
			'Reports the Linear OAuth connection used by issue browsing, issue workflows, and workspace creation from issues.',
		group: 'linear',
		id: 'linear-oauth',
		onError: (error) => ({
			detail:
				error instanceof Error ? error.message : 'Unknown Linear check error.',
			remediationActions: LINEAR_REMEDIATION_ACTIONS,
			status: 'warning',
		}),
		run: async () => {
			const snapshot = await deps.linearAuthService.getConnectionStatus();

			return {
				detail: describeConnection(snapshot),
				remediationActions: LINEAR_REMEDIATION_ACTIONS,
				status: statusForConnection(snapshot),
			};
		},
		title: 'Linear connection',
	});

	return check(deps.context);
}

function statusForConnection(
	snapshot: LinearConnectionSnapshot,
): SetupCheckStatus {
	return snapshot.state === 'connected' ? 'success' : 'warning';
}

function describeConnection(snapshot: LinearConnectionSnapshot): string {
	switch (snapshot.state) {
		case 'connected': {
			const identity = snapshot.userName ?? snapshot.userEmail;
			const organization = snapshot.organizationName;

			if (identity && organization) {
				return `Linear is connected as ${identity} (${organization}).`;
			}

			return identity
				? `Linear is connected as ${identity}.`
				: 'Linear is connected.';
		}
		case 'not-configured':
			return 'Linear OAuth is not configured. Add app.linear.clientId to the Ensemble config to enable Linear workflows. Linear is optional for local and GitHub-only workflows.';
		case 'reconnect-required':
			return 'The stored Linear token expired and cannot be refreshed. Reconnect Linear from integration settings.';
		default:
			return 'Linear is not connected. Sign in from integration settings to enable Linear workflows.';
	}
}
