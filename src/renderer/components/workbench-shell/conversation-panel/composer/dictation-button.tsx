import { MicIcon, SquareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import type { DictationControl } from '@/renderer/hooks/workbench-shell/composer/use-dictation';
import { formatShortcut } from '@/shared/keymap';

/**
 * Renders elapsed recording time as `m:ss`, so a long dictation shows what it
 * has cost before the user stops it.
 * @param elapsedMs - Milliseconds since recording began
 * @returns The clock readout
 */
function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const seconds = totalSeconds % 60;
	return `${Math.floor(totalSeconds / 60)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The composer's microphone control. Click to record, click again to stop and
 * transcribe; the same chord toggles it. It renders nothing when dictation is
 * unconfigured, so the settings row is the only place it can be discovered
 * rather than a permanently dead button sitting in the control row.
 */
export function DictationButton({
	dictation,
}: {
	dictation: DictationControl;
}) {
	const { t } = useTranslation();

	if (!dictation.available) {
		return null;
	}

	const { elapsedMs, phase, toggle } = dictation;
	const isRecording = phase === 'recording';
	const isBusy = phase === 'requesting' || phase === 'transcribing';

	const label = isRecording
		? t('workbench:composer.dictation.stop', 'Stop dictation')
		: t('workbench:composer.dictation.start', 'Dictate a prompt');

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>
					<Button
						aria-label={label}
						className='rounded-md'
						disabled={isBusy}
						onClick={toggle}
						size={isRecording ? 'sm' : 'icon-sm'}
						type='button'
						variant={isRecording ? 'destructive' : 'ghost'}
					>
						{isBusy ? <Spinner /> : null}
						{isRecording ? <SquareIcon /> : null}
						{!isBusy && !isRecording ? <MicIcon /> : null}
						{isRecording ? (
							<span className='text-xs tabular-nums'>
								{formatElapsed(elapsedMs)}
							</span>
						) : null}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{phase === 'transcribing'
					? t('workbench:composer.dictation.transcribing', 'Transcribing…')
					: label}
				<span className='ml-2 text-muted-foreground'>
					{formatShortcut('composer.toggleDictation')}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
