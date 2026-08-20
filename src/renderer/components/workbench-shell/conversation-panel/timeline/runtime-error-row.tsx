import type { TFunction } from 'i18next';
import {
	ChevronRightIcon,
	FolderXIcon,
	GaugeIcon,
	GitBranchIcon,
	KeyRoundIcon,
	LayersIcon,
	type LucideIcon,
	PlayIcon,
	PowerOffIcon,
	RotateCcwIcon,
	ScissorsIcon,
	ServerCrashIcon,
	SettingsIcon,
	ShieldAlertIcon,
	ShieldCheckIcon,
	SquarePenIcon,
	TerminalIcon,
	TriangleAlertIcon,
	WifiOffIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CopyResponseButton } from '@/renderer/components/copy-response-button';
import { StackTraceDiagnostic } from '@/renderer/components/stack-trace-diagnostic';
import { Button } from '@/renderer/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import {
	type AgentFailureAction,
	type AgentFailureIcon,
	type AgentFailureSeverity,
	describeAgentFailure,
} from '@/renderer/lib/agent-failure-text';
import { looksLikeStackTrace } from '@/renderer/lib/agent-timeline';
import { cn } from '@/renderer/lib/utils';
import type { AgentWireError } from '@/shared/ipc/contracts/agent-session';

/** The recoveries a surface can wire; an action with no handler is not rendered. */
export interface RuntimeErrorHandlers {
	onContinue?: () => void;
	onEditPrompt?: () => void;
	onFork?: () => void;
	onOpenPermissions?: () => void;
	onOpenProviderSettings?: () => void;
	onRetry?: () => void;
}

/** Glyph per failure class, resolved from the name the copy table chose. */
const FAILURE_ICONS: Readonly<Record<AgentFailureIcon, LucideIcon>> = {
	'folder-x': FolderXIcon,
	gauge: GaugeIcon,
	'key-round': KeyRoundIcon,
	layers: LayersIcon,
	'power-off': PowerOffIcon,
	scissors: ScissorsIcon,
	'server-crash': ServerCrashIcon,
	'shield-alert': ShieldAlertIcon,
	terminal: TerminalIcon,
	'triangle-alert': TriangleAlertIcon,
	'wifi-off': WifiOffIcon,
};

/** Glyph per recovery action, so each button reads at a glance. */
const ACTION_ICONS: Readonly<Record<AgentFailureAction, LucideIcon>> = {
	continue: PlayIcon,
	'edit-prompt': SquarePenIcon,
	fork: GitBranchIcon,
	'open-permissions': ShieldCheckIcon,
	'open-provider-settings': SettingsIcon,
	retry: RotateCcwIcon,
};

/** Border, tint, and accent per severity, tokenized so both themes follow. */
const SEVERITY_STYLES: Readonly<
	Record<AgentFailureSeverity, { accent: string; container: string }>
> = {
	danger: {
		accent: 'text-status-danger',
		container: 'border-status-danger/30 bg-status-danger/5',
	},
	warning: {
		accent: 'text-status-warning',
		container: 'border-status-warning/30 bg-status-warning/5',
	},
};

/**
 * The timeline's one designed row for a runtime failure: a bounded card whose
 * headline says what happened in the reader's language, whose buttons say what
 * to do about it, and whose disclosure holds the runtime's own words.
 *
 * The provider's raw sentence is never the headline — it is English forever and
 * carries no affordance — but it is never discarded either, because it is the
 * only thing that distinguishes two failures of the same class.
 */
export function RuntimeErrorRow({
	failure,
	handlers,
}: {
	failure: AgentWireError;
	handlers: RuntimeErrorHandlers;
}) {
	const { t } = useTranslation();
	const readout = describeAgentFailure(t, failure);
	const severity = SEVERITY_STYLES[readout.severity];
	const FailureIcon = FAILURE_ICONS[readout.icon];
	const actions = readout.actions.filter((action) =>
		Boolean(handlerFor(handlers, action)),
	);

	return (
		<div
			className={cn(
				'flex w-full flex-col gap-2 rounded-lg border p-3',
				severity.container,
			)}
			data-failure-class={readout.failureClass}
			data-role='runtime-error'
			role='alert'
		>
			<div className='flex items-start gap-2'>
				<FailureIcon
					aria-hidden='true'
					className={cn('mt-0.5 size-4 shrink-0', severity.accent)}
				/>
				<div className='flex min-w-0 flex-col gap-1'>
					<p className={cn('font-medium text-sm', severity.accent)}>
						{readout.title}
					</p>
					<p className='text-muted-foreground text-xs'>{readout.body}</p>
				</div>
			</div>

			{actions.length > 0 ? (
				<div className='flex flex-wrap items-center gap-1.5 pl-6'>
					{actions.map((action) => (
						<RecoveryButton
							action={action}
							key={action}
							onClick={handlerFor(handlers, action)}
						/>
					))}
				</div>
			) : null}

			<RuntimeErrorDetails detail={readout.detail} raw={readout.raw} />
		</div>
	);
}

/** One recovery button, labelled and iconed from the action it performs. */
function RecoveryButton({
	action,
	onClick,
}: {
	action: AgentFailureAction;
	onClick?: () => void;
}) {
	const { t } = useTranslation();
	const ActionIcon = ACTION_ICONS[action];

	return (
		<Button onClick={onClick} size='xs' type='button' variant='outline'>
			<ActionIcon aria-hidden='true' data-icon='inline-start' />
			{recoveryLabel(t, action)}
		</Button>
	);
}

/**
 * The runtime's own words, folded away behind a disclosure so the designed copy
 * leads and the untranslated provider string stays available for a bug report.
 *
 * A detail that is a stack trace gets the frame-parsing viewer instead of a
 * plain block — it carries its own disclosure and copy button, so the row lets
 * it own the fold rather than nesting two.
 */
function RuntimeErrorDetails({
	detail,
	raw,
}: {
	detail: string | null;
	raw: string;
}) {
	const { t } = useTranslation();
	const body = detail ? `${raw}\n\n${detail}` : raw;

	if (!raw) {
		return null;
	}

	if (looksLikeStackTrace(body)) {
		return (
			<div className='pl-6'>
				<StackTraceDiagnostic className='border-border/60' trace={body} />
			</div>
		);
	}

	return (
		<Collapsible className='pl-6'>
			<div className='flex items-center gap-1'>
				<CollapsibleTrigger className='group inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground'>
					<ChevronRightIcon
						aria-hidden='true'
						className='size-3.5 transition-transform group-data-[state=open]:rotate-90'
					/>
					{t('workbench:timeline.error.details', 'Runtime detail')}
				</CollapsibleTrigger>
				<CopyResponseButton
					label={t(
						'workbench:timeline.error.copy-detail',
						'Copy the runtime detail',
					)}
					text={body}
				/>
			</div>
			<CollapsibleContent>
				<pre className='wrap-break-word mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-2 font-mono text-muted-foreground text-xs'>
					{body}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * Picks the handler a surface wired for one action.
 * @param handlers - The recoveries this surface supports
 * @param action - The action being rendered
 * @returns The handler, or undefined when the surface cannot perform it
 */
function handlerFor(
	handlers: RuntimeErrorHandlers,
	action: AgentFailureAction,
): (() => void) | undefined {
	switch (action) {
		case 'continue':
			return handlers.onContinue;
		case 'edit-prompt':
			return handlers.onEditPrompt;
		case 'fork':
			return handlers.onFork;
		case 'open-permissions':
			return handlers.onOpenPermissions;
		case 'open-provider-settings':
			return handlers.onOpenProviderSettings;
		case 'retry':
			return handlers.onRetry;
	}
}

/**
 * The button label for one recovery action.
 * @param t - Translator bound to the active language
 * @param action - The action being labelled
 * @returns The translated label
 */
function recoveryLabel(t: TFunction, action: AgentFailureAction): string {
	switch (action) {
		case 'continue':
			return t('workbench:timeline.error.continue', 'Continue');
		case 'edit-prompt':
			return t('workbench:timeline.error.edit-prompt', 'Edit the prompt');
		case 'fork':
			return t('workbench:timeline.error.fork', 'Fork chat');
		case 'open-permissions':
			return t(
				'workbench:timeline.error.open-permissions',
				'Permission settings',
			);
		case 'open-provider-settings':
			return t('workbench:timeline.error.open-settings', 'Open settings');
		case 'retry':
			return t('workbench:timeline.error.retry', 'Send again');
	}
}
