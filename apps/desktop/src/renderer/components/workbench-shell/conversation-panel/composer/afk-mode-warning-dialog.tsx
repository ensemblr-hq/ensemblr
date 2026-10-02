import { KeyboardOffIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';

/** First-use warning that explains AFK mode's unusually high token appetite. */
export function AfkModeWarningDialog({
	disabled = false,
	onAcknowledge,
	onGoBack,
	open,
}: {
	disabled?: boolean;
	onAcknowledge: () => void;
	onGoBack: () => void;
	open: boolean;
}) {
	const { t } = useTranslation();

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					onGoBack();
				}
			}}
			open={open}
		>
			<DialogContent className='gap-5 sm:max-w-md' showCloseButton={false}>
				<DialogHeader className='pr-8'>
					<div className='flex items-start gap-3'>
						<div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-away/10 text-status-away'>
							<KeyboardOffIcon className='size-4' />
						</div>
						<div className='space-y-1.5'>
							<DialogTitle>
								{t(
									'workbench:afk-mode.warning.title',
									'Before you turn on AFK',
								)}
							</DialogTitle>
							<DialogDescription>
								{t(
									'workbench:afk-mode.warning.best-work',
									'While you are away, AFK mode gives agents room to plan, build, review, and refine—pushing for their absolute best work without waiting for you.',
								)}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>
				<div className='flex gap-2.5 rounded-lg bg-status-warning/10 p-3 text-sm'>
					<TriangleAlertIcon className='mt-0.5 size-4 shrink-0 text-status-warning' />
					<p>
						{t(
							'workbench:afk-mode.warning.token-cost',
							'AFK mode is token-intensive and can use substantially more tokens than attended work.',
						)}
					</p>
				</div>
				<p className='text-muted-foreground text-xs'>
					{t(
						'workbench:afk-mode.warning.acknowledgment',
						'Use it cautiously and sparingly. Turning it on acknowledges this warning, so you will not see it again.',
					)}
				</p>
				<DialogFooter>
					<Button onClick={onGoBack} variant='ghost'>
						{t('workbench:afk-mode.warning.go-back', 'Not now')}
					</Button>
					<Button disabled={disabled} onClick={onAcknowledge}>
						{t('workbench:afk-mode.warning.acknowledge', 'Turn on AFK')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
