import {
	AlertCircleIcon,
	CheckCircle2Icon,
	ExternalLinkIcon,
	FolderIcon,
	RefreshCwIcon,
	SettingsIcon,
	ShieldAlertIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DiagnosticsLogCollapsible } from '@/renderer/components/diagnostics-log-collapsible';
import { CopyCommandButton } from '@/renderer/components/settings/agent-providers/copy-command-button';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type { AgentProviderCheckWire } from '@/shared/ipc/contracts/agent-provider';
import type {
	SetupRemediationAction,
	SetupRemediationActionKind,
} from '@/shared/ipc/contracts/setup';

/** Status a provider readiness check can report, taken from the wire contract. */
type CheckStatus = AgentProviderCheckWire['status'];

const CHECK_STATUS_TONE = {
	failure: 'danger',
	success: 'ok',
	warning: 'warning',
} satisfies Record<CheckStatus, 'danger' | 'ok' | 'warning'>;

const CHECK_STATUS_ICON = {
	failure: AlertCircleIcon,
	success: CheckCircle2Icon,
	warning: ShieldAlertIcon,
} satisfies Record<CheckStatus, typeof AlertCircleIcon>;

const CHECK_STATUS_ICON_COLOR = {
	failure: 'text-status-danger',
	success: 'text-status-ok',
	warning: 'text-status-warning',
} satisfies Record<CheckStatus, string>;

const REMEDIATION_ICON = {
	'open-external': ExternalLinkIcon,
	'open-settings': SettingsIcon,
	'run-command': RefreshCwIcon,
	retry: RefreshCwIcon,
	'select-path': FolderIcon,
} satisfies Record<SetupRemediationActionKind, typeof RefreshCwIcon>;

/** Left indent aligning secondary content under the check title (icon + gap). */
const CONTENT_INDENT = 'pl-6.5';

/**
 * One readiness check for an agent provider: status icon, label, detail line,
 * remediation buttons, and a collapsible command log. Both provider tabs render
 * this same row from `AgentProviderCheckWire`, so a Claude auth failure and a Pi
 * RPC failure read identically.
 */
export function ProviderCheckRow({
	check,
	onRemediation,
}: {
	check: AgentProviderCheckWire;
	onRemediation: (action: SetupRemediationAction) => void;
}) {
	const { t } = useTranslation();
	const Icon = CHECK_STATUS_ICON[check.status];
	const logs = check.logs ?? [];
	const statusLabels: Record<CheckStatus, string> = {
		failure: t('settings:providers.check-status.failure', 'Failed'),
		success: t('settings:providers.check-status.success', 'Ready'),
		warning: t('settings:providers.check-status.warning', 'Warning'),
	};

	return (
		<li className='flex flex-col gap-2 px-3 py-3'>
			<div className='flex items-start justify-between gap-3'>
				<div className='flex min-w-0 items-start gap-2.5'>
					<Icon
						aria-hidden='true'
						className={cn(
							'mt-0.5 size-4 shrink-0',
							CHECK_STATUS_ICON_COLOR[check.status],
						)}
					/>
					<div className='min-w-0 space-y-0.5'>
						<p className='font-medium text-sm leading-snug'>{check.label}</p>
						{check.detail ? (
							<p className='wrap-break-word text-muted-foreground text-xs leading-5'>
								{check.detail}
							</p>
						) : null}
					</div>
				</div>
				<StatusBadge
					className='mt-0.5 shrink-0'
					tone={CHECK_STATUS_TONE[check.status]}
				>
					{statusLabels[check.status]}
				</StatusBadge>
			</div>

			{check.remediations.length ? (
				<div className={cn('flex flex-wrap gap-1.5', CONTENT_INDENT)}>
					{check.remediations.map((action) => (
						<RemediationButton
							action={action}
							key={action.id}
							onRemediation={onRemediation}
						/>
					))}
				</div>
			) : null}

			<DiagnosticsLogCollapsible className={CONTENT_INDENT} logs={logs} />
		</li>
	);
}

/**
 * Renders one remediation. A `run-command` action copies to the clipboard and
 * never spawns anything; every other kind is delegated to the panel.
 */
function RemediationButton({
	action,
	onRemediation,
}: {
	action: SetupRemediationAction;
	onRemediation: (action: SetupRemediationAction) => void;
}) {
	if (action.kind === 'run-command') {
		return action.command ? (
			<CopyCommandButton command={action.command} label={action.label} />
		) : null;
	}

	const Icon = REMEDIATION_ICON[action.kind];

	return (
		<Button
			data-remediation-action={action.id}
			onClick={() => onRemediation(action)}
			size='xs'
			type='button'
			variant='outline'
		>
			<Icon aria-hidden='true' data-icon='inline-start' />
			{action.label}
		</Button>
	);
}
