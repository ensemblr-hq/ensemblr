import { useAtomValue } from 'jotai';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import type { ComposerStateApi } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';
import { cn } from '@/renderer/lib/utils';
import {
	resolveComposerProvider,
	showContextIndicator,
} from '@/renderer/lib/workbench';
import {
	alwaysShowContextUsageAtom,
	sendShortcutAtom,
} from '@/renderer/state/preferences';
import type { ComposerShellState } from '@/renderer/types/workbench';
import { formatShortcut } from '@/shared/keymap';
import { AttachmentMenu } from './attachment-menu';
import { ContextIndicator } from './context-indicator';
import { McpServersPanel } from './mcp-servers-panel';
import { ModelPicker } from './model-picker';
import { PlanModeToggle } from './plan-mode-toggle';
import { ThinkingPicker } from './thinking-picker';

/** Wiring for the composer's bottom control row. */
interface ComposerControlsProps {
	composer: ComposerShellState;
	modelPickerOpen: boolean;
	onLinkIssue: () => void;
	onModelPickerOpenChange: (open: boolean) => void;
	/** True while a turn is streaming or the composer is disabled outright. */
	pickersDisabled: boolean;
	state: ComposerStateApi;
	/** Workspace whose dock hosts the terminal the MCP panel hands auth off to. */
	workspaceId: string;
}

/**
 * The composer's bottom control row: model, thinking, and plan-mode chips on
 * the left; context gauge, attachment menu, and the send/stop control on the
 * right. Split out of `ComposerPanel` so the panel stays a layout shell and the
 * row's send/stop and tooltip branching lives with the controls it describes.
 */
export function ComposerControls({
	composer,
	modelPickerOpen,
	onLinkIssue,
	onModelPickerOpenChange,
	pickersDisabled,
	state,
	workspaceId,
}: ComposerControlsProps) {
	const sendShortcut = useAtomValue(sendShortcutAtom);
	const alwaysShowContext = useAtomValue(alwaysShowContextUsageAtom);
	const sendShortcutHint = formatShortcut(
		sendShortcut === 'mod+enter' ? 'composer.submitWithMod' : 'composer.submit',
	);
	const provider = resolveComposerProvider(composer);

	return (
		<div className='flex items-center justify-between gap-2'>
			<div className='flex min-w-0 items-center gap-1.5'>
				<ModelPicker
					disabled={pickersDisabled}
					lockedProvider={composer.lockedProvider}
					onChange={composer.onModelChange}
					onOpenChange={onModelPickerOpenChange}
					open={modelPickerOpen}
					options={composer.availableModels}
					value={composer.modelId}
				/>
				<ThinkingPicker
					disabled={pickersDisabled}
					onChange={composer.onThinkingChange}
					options={composer.availableThinkingLevels}
					provider={provider}
					value={composer.thinkingLevel}
				/>
				<PlanModeToggle
					disabled={pickersDisabled}
					onChange={composer.onPlanModeChange}
					value={composer.planMode}
				/>
			</div>
			<div className='flex items-center gap-1'>
				{provider === 'claude' ? (
					<McpServersPanel
						cwd={composer.workspaceCwd}
						disabled={composer.disabled}
						workspaceId={workspaceId}
					/>
				) : null}
				{showContextIndicator(composer, alwaysShowContext) ? (
					<ContextIndicator usage={composer.contextUsage} />
				) : null}
				<AttachmentMenu
					disabled={composer.disabled}
					onAddAttachment={state.handleAddAttachment}
					onLinkIssue={onLinkIssue}
				/>
				<SubmitControl
					composer={composer}
					sendShortcutHint={sendShortcutHint}
					state={state}
				/>
			</div>
		</div>
	);
}

/**
 * The send / stop control and its tooltip. Stop shows only while the agent
 * is working AND there is nothing to send — the moment the user drafts a
 * follow-up the control becomes Send, so a live turn never hides the ability
 * to steer.
 */
function SubmitControl({
	composer,
	sendShortcutHint,
	state,
}: {
	composer: ComposerShellState;
	sendShortcutHint: string;
	state: ComposerStateApi;
}) {
	const { t } = useTranslation();
	const showStop = state.isStreaming && !state.hasContent;
	if (showStop) {
		return (
			<Button
				aria-label={t('common:actions.stop', 'Stop')}
				className='rounded-md'
				onClick={() => void composer.onStop()}
				size='icon-sm'
				type='button'
				variant='outline'
			>
				{state.pending ? <Spinner /> : <SquareIcon />}
			</Button>
		);
	}

	const sendButton = (
		<Button
			aria-label={t('common:actions.send', 'Send')}
			className={cn(
				'rounded-md',
				!state.canSend &&
					'bg-muted text-muted-foreground hover:bg-muted hover:text-muted-foreground',
			)}
			disabled={!state.canSend}
			onClick={() => void state.handleSubmit()}
			size='icon-sm'
			type='button'
			variant={state.canSend ? 'default' : 'secondary'}
		>
			<ArrowUpIcon />
		</Button>
	);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>{sendButton}</span>
			</TooltipTrigger>
			<TooltipContent>
				{composer.disabled && composer.disabledReason ? (
					composer.disabledReason
				) : (
					<>
						{t('workbench:composer.send-tooltip', 'Send message')}
						<span className='ml-2 text-muted-foreground'>
							{sendShortcutHint}
						</span>
					</>
				)}
			</TooltipContent>
		</Tooltip>
	);
}
