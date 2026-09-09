import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { AfkModeWarningDialog } from '@/renderer/components/workbench-shell/conversation-panel/composer/afk-mode-warning-dialog';

import { SceneSection } from './scene-chrome.tsx';

/** Interactive preview of the first-use AFK acknowledgment dialog. */
export function AfkModeWarningScene() {
	const [open, setOpen] = useState(true);
	const [lastAction, setLastAction] = useState('waiting for a decision');

	return (
		<SceneSection
			label='AFK first-use warning'
			note='selecting this scene opens the shipped dialog; reopen it to inspect both actions'
		>
			<div className='flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-pane/80 p-6'>
				<Button onClick={() => setOpen(true)}>Open AFK warning</Button>
				<span className='font-mono text-muted-foreground text-xxs'>
					{lastAction}
				</span>
			</div>
			<AfkModeWarningDialog
				onAcknowledge={() => {
					setLastAction('acknowledged — AFK would activate');
					setOpen(false);
				}}
				onGoBack={() => {
					setLastAction('went back — warning will appear next time');
					setOpen(false);
				}}
				open={open}
			/>
		</SceneSection>
	);
}
