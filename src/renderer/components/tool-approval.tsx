/**
 * The per-tool approval card. A Claude session in `approval-required` mode is
 * blocked inside the SDK's `canUseTool` until this resolves, so it takes the
 * composer's place in the chat that raised it — the same swap the agent
 * questionnaire uses, for the same reason.
 *
 * It wears the composer's frame with an accent band across the top: the shape
 * says "this is where you act", the band says the app is waiting rather than
 * offering. Plan mode's dashed accent border is the sibling signal, kept
 * distinct because that one is a draft and this one is a block.
 */
import type { TFunction } from 'i18next';
import { XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ApprovalActions } from '@/renderer/components/tool-approval/approval-actions';
import { ApprovalInput } from '@/renderer/components/tool-approval/approval-input';
import { ApprovalMark } from '@/renderer/components/tool-approval/approval-mark';
import { Button } from '@/renderer/components/ui/button';
import type {
	ToolApprovalDecision,
	ToolApprovalRequestedBroadcast,
} from '@/shared/agent-tool-approval';

/** Decision each shortcut key stands for. */
const DECISION_KEYS: Readonly<
	Record<string, ToolApprovalDecision | undefined>
> = {
	'1': { kind: 'allow' },
	'2': { kind: 'allow-for-session' },
	'3': { kind: 'deny' },
	Escape: { kind: 'deny' },
};

/**
 * The sentence at the top of the card. Claude Code supplies its own prompt for
 * most tools; the fallback names the tool so an unrecognised one still reads.
 * @param request - The pending prompt.
 * @param t - Translator from the calling component.
 * @returns The headline to show.
 */
function headlineFor(
	request: ToolApprovalRequestedBroadcast,
	t: TFunction,
): string {
	return (
		request.title ??
		t('common:tool-approval.headline', 'Claude wants to use {{tool}}.', {
			tool: request.displayName ?? request.toolName,
		})
	);
}

/**
 * Renders the tool call a Claude session is blocked on.
 *
 * Keyboard: `1` allows once, `2` allows this tool for the rest of the session,
 * `3` and Escape deny.
 */
export function ToolApprovalCard({
	onDecide,
	request,
}: {
	onDecide: (decision: ToolApprovalDecision) => void;
	request: ToolApprovalRequestedBroadcast;
}) {
	const { t } = useTranslation();
	const shellRef = useRef<HTMLElement>(null);
	const decideRef = useRef(onDecide);

	useEffect(() => {
		decideRef.current = onDecide;
	}, [onDecide]);

	useEffect(() => {
		shellRef.current?.focus();
	}, []);

	const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		const decision = DECISION_KEYS[event.key];
		if (!decision) {
			return;
		}
		event.preventDefault();
		decideRef.current(decision);
	}, []);

	const headlineNamesTool =
		request.title === undefined && request.displayName === undefined;
	const showsMeta = !headlineNamesTool || request.description !== undefined;

	return (
		<footer className='shrink-0 bg-background px-4 pt-2 pb-5'>
			<section
				aria-label={t(
					'common:tool-approval.section-label',
					'Tool approval request',
				)}
				className='@container/approval mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-accent-strong/35 bg-pane/80 shadow-panel outline-none'
				onKeyDown={handleKeyDown}
				ref={shellRef}
				tabIndex={-1}
			>
				<p className='sr-only' role='status'>
					{t('common:tool-approval.status', 'Approval required for {{tool}}.', {
						tool: request.toolName,
					})}
				</p>

				<header className='flex items-start gap-2.5 border-accent-strong/20 border-b bg-accent-strong/[0.06] px-3 py-2.5'>
					<ApprovalMark toolName={request.toolName} />
					<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
						<h2 className='text-pretty font-medium text-foreground text-sm leading-5'>
							{headlineFor(request, t)}
						</h2>
						{showsMeta ? (
							<p className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs leading-4'>
								{headlineNamesTool ? null : (
									<span className='shrink-0 rounded-sm bg-foreground/[0.07] px-1 py-0.5 font-mono text-foreground text-xxs leading-4'>
										{request.toolName}
									</span>
								)}
								{request.description ? (
									<span className='min-w-0 truncate'>
										{request.description}
									</span>
								) : null}
							</p>
						) : null}
					</div>
					<Button
						aria-label={t('common:tool-approval.deny-label', 'Deny tool call')}
						className='-mr-1'
						onClick={() => onDecide({ kind: 'deny' })}
						size='icon-xs'
						type='button'
						variant='subtle'
					>
						<XIcon aria-hidden='true' />
					</Button>
				</header>

				<ApprovalInput input={request.input} />

				<ApprovalActions onDecide={onDecide} />
			</section>
		</footer>
	);
}
