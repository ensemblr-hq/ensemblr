import type { LinearConnectionSnapshot } from '../../shared/ipc/contracts/linear';
import type {
	SetupCheckStatus,
	SetupRemediationAction,
} from '../../shared/ipc/contracts/setup';
import type { LinearAuthService } from '../linear';
import {
	authoredDetail,
	defineCheck,
	type SetupCheckProviderContext,
	unexpectedErrorDetail,
} from './setup-check-context.ts';

/** Dependencies for the Linear setup check. */
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
			...unexpectedErrorDetail(error, {
				code: 'linear-unknown-error',
				text: 'Unknown Linear check error.',
			}),
			remediationActions: LINEAR_REMEDIATION_ACTIONS,
			status: 'warning',
		}),
		run: async () => {
			const snapshot = await deps.linearAuthService.getConnectionStatus();

			return {
				...describeConnection(snapshot),
				remediationActions: LINEAR_REMEDIATION_ACTIONS,
				status: statusForConnection(snapshot),
			};
		},
		title: 'Linear connection',
	});

	return check(deps.context);
}

/**
 * Map a Linear connection snapshot to a setup-check status.
 * @param snapshot - Current Linear connection state
 * @returns `'success'` when connected, otherwise `'warning'`
 */
function statusForConnection(
	snapshot: LinearConnectionSnapshot,
): SetupCheckStatus {
	return snapshot.state === 'connected' ? 'success' : 'warning';
}

/**
 * Build the user-facing detail describing the Linear connection state.
 * @param snapshot - Current Linear connection state
 * @returns The detail fields for the check result
 */
function describeConnection(snapshot: LinearConnectionSnapshot) {
	switch (snapshot.state) {
		case 'connected': {
			const identity = snapshot.userName ?? snapshot.userEmail;
			const organization = snapshot.organizationName;

			if (identity && organization) {
				return authoredDetail(
					'linear-connected-with-organization',
					`Linear is connected as ${identity} (${organization}).`,
					{ identity, organization },
				);
			}

			return identity
				? authoredDetail(
						'linear-connected-as',
						`Linear is connected as ${identity}.`,
						{ identity },
					)
				: authoredDetail('linear-connected', 'Linear is connected.');
		}
		case 'not-configured':
			return authoredDetail(
				'linear-not-configured',
				'Linear OAuth is not configured. Add app.linear.clientId to the Ensemblr config to enable Linear workflows. Linear is optional for local and GitHub-only workflows.',
			);
		case 'reconnect-required':
			return authoredDetail(
				'linear-reconnect-required',
				'The stored Linear token expired and cannot be refreshed. Reconnect Linear from integration settings.',
			);
		default:
			return authoredDetail(
				'linear-not-connected',
				'Linear is not connected. Sign in from integration settings to enable Linear workflows.',
			);
	}
}
