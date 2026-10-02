/**
 * Decision row for a pending tool call. Each button carries the number key that
 * fires it, so the shortcut sits on the control rather than in a legend beside
 * it that the eye has to pair back up.
 *
 * The Escape hint drops out whole once the card's `approval` container is too
 * narrow to hold it: clipped to "Esc" it reads as an artefact, and the header
 * already offers a dismiss control for the same decision.
 */
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import type { ToolApprovalDecision } from '@/shared/agent-tool-approval';

/**
 * The number-key glyph a decision button carries. A plain span rather than a
 * `kbd`: it is hidden from assistive technology — the button already announces
 * what it does — so the keyboard semantics would go to nobody.
 */
function DecisionKey({ children }: { children: string }) {
	return (
		<span aria-hidden='true' className='font-sans text-xxs opacity-55'>
			{children}
		</span>
	);
}

/** Renders the three ways out of a pending tool approval. */
export function ApprovalActions({
	onDecide,
}: {
	onDecide: (decision: ToolApprovalDecision) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className='flex items-center justify-end gap-3 border-border/60 border-t px-3 py-2'>
			<p className='mr-auto flex @max-md/approval:hidden min-w-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground/70 text-xs'>
				<Trans
					components={{
						// Sans, not the kbd UA monospace, to match the composer's own hint.
						key: (
							<kbd className='rounded-sm border border-border bg-background px-1 font-sans text-xxs leading-4' />
						),
					}}
					defaults='<key>Esc</key> to deny'
					i18nKey='common:tool-approval.esc-hint'
				/>
			</p>
			<div className='flex shrink-0 items-center gap-1'>
				<Button
					onClick={() => onDecide({ kind: 'deny' })}
					size='sm'
					type='button'
					variant='ghost'
				>
					{t('common:actions.deny', 'Deny')}
					<DecisionKey>3</DecisionKey>
				</Button>
				<Button
					onClick={() => onDecide({ kind: 'allow-for-session' })}
					size='sm'
					type='button'
					variant='outline'
				>
					{t('common:tool-approval.allow-session', 'Allow for this session')}
					<DecisionKey>2</DecisionKey>
				</Button>
				<Button onClick={() => onDecide({ kind: 'allow' })} size='sm'>
					{t('common:actions.allow', 'Allow')}
					<DecisionKey>1</DecisionKey>
				</Button>
			</div>
		</div>
	);
}
