import type { TFunction } from 'i18next';
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	CheckIcon,
	CircleDashedIcon,
	ClipboardIcon,
	ExternalLinkIcon,
	FolderIcon,
	RefreshCwIcon,
	SettingsIcon,
	ShieldAlertIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DiagnosticsLogCollapsible } from '@/renderer/components/diagnostics-log-collapsible';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import type {
	SetupCheckSnapshot,
	SetupCheckStatus,
	SetupRemediationAction,
	SetupRemediationActionKind,
} from '@/shared/ipc/contracts/setup';

/**
 * Names the badge shown beside one check.
 * @param status - Lifecycle status the check reported.
 * @param t - Translator from the calling component.
 * @returns The badge text.
 */
function checkStatusLabel(status: SetupCheckStatus, t: TFunction): string {
	switch (status) {
		case 'failure':
			return t('common:setup-check.status.failure', 'Failed');
		case 'pending':
			return t('common:setup-check.status.pending', 'Pending');
		case 'running':
			return t('common:setup-check.status.running', 'Running');
		case 'success':
			return t('common:setup-check.status.success', 'Ready');
		case 'warning':
			return t('common:setup-check.status.warning', 'Warning');
	}
}

const CHECK_STATUS_TONE: Record<
	SetupCheckStatus,
	'danger' | 'info' | 'muted' | 'ok' | 'warning'
> = {
	failure: 'danger',
	pending: 'muted',
	running: 'info',
	success: 'ok',
	warning: 'warning',
};

const CHECK_STATUS_ICON = {
	failure: AlertCircleIcon,
	pending: CircleDashedIcon,
	running: RefreshCwIcon,
	success: CheckCircle2Icon,
	warning: ShieldAlertIcon,
} satisfies Record<SetupCheckStatus, typeof AlertCircleIcon>;

const CHECK_STATUS_ICON_COLOR: Record<SetupCheckStatus, string> = {
	failure: 'text-status-danger',
	pending: 'text-muted-foreground',
	running: 'text-accent-strong',
	success: 'text-status-ok',
	warning: 'text-status-warning',
};

const REMEDIATION_ICON = {
	'open-external': ExternalLinkIcon,
	'open-settings': SettingsIcon,
	'run-command': ClipboardIcon,
	retry: RefreshCwIcon,
	'select-path': FolderIcon,
} satisfies Record<SetupRemediationActionKind, typeof RefreshCwIcon>;

/** Left indent that aligns secondary content under the row title (icon + gap). */
const CONTENT_INDENT = 'pl-6.5';

/** Single setup-check row: status icon, title, detail line, logs, remediations. */
export function SetupCheckRow({
	check,
	onRemediationAction,
}: {
	check: SetupCheckSnapshot;
	onRemediationAction?: (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => void | Promise<void>;
}) {
	const { t } = useTranslation();
	const Icon = CHECK_STATUS_ICON[check.status];
	const [copiedActionId, setCopiedActionId] = useState<string | null>(null);

	const runRemediationAction = async (action: SetupRemediationAction) => {
		// `run-command` is a pure renderer concern: copy the suggested command to
		// the clipboard (never auto-runs it) and flash a transient confirmation on
		// the originating button. Gating the flash on a successful write keeps us
		// from showing a false "Copied" when the clipboard is unavailable.
		if (action.kind === 'run-command') {
			if (!action.command) {
				return;
			}

			try {
				await navigator.clipboard.writeText(action.command);
				setCopiedActionId(action.id);
				window.setTimeout(() => setCopiedActionId(null), 1800);
			} catch (error) {
				console.error('Failed to copy command to clipboard:', error);
			}

			return;
		}

		await onRemediationAction?.(action, check);
	};

	return (
		<div className='flex flex-col gap-2 px-3 py-3.5'>
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
						<p className='font-medium text-sm leading-snug'>
							{check.title}
							{check.blocking ? null : (
								<span className='ml-2 font-normal text-muted-foreground text-xs'>
									{t('common:setup-check.optional', 'Optional')}
								</span>
							)}
						</p>
						<p className='text-muted-foreground text-xs leading-5'>
							{check.detail}
						</p>
					</div>
				</div>
				<StatusBadge
					className='mt-0.5 shrink-0'
					tone={CHECK_STATUS_TONE[check.status]}
				>
					{checkStatusLabel(check.status, t)}
				</StatusBadge>
			</div>

			{check.remediationActions.length ? (
				<div className={cn('flex flex-wrap gap-1.5', CONTENT_INDENT)}>
					{check.remediationActions.map((action) => {
						const copied =
							action.kind === 'run-command' && copiedActionId === action.id;
						const ActionIcon = copied
							? CheckIcon
							: REMEDIATION_ICON[action.kind];

						return (
							<Button
								data-remediation-action={action.id}
								key={action.id}
								onClick={() => {
									void runRemediationAction(action);
								}}
								size='xs'
								type='button'
								variant='outline'
							>
								<ActionIcon aria-hidden='true' data-icon='inline-start' />
								{copied ? t('common:actions.copied', 'Copied') : action.label}
							</Button>
						);
					})}
				</div>
			) : null}

			<DiagnosticsLogCollapsible className={CONTENT_INDENT} logs={check.logs} />
		</div>
	);
}
