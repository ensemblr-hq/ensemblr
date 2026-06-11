import { CheckIcon, ClipboardIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

const COPY_FEEDBACK_MS = 1500;

/**
 * Icon-only clipboard button that copies the given text and flips to a check
 * for ~1.5s on success. Shared by the assistant turn footer and the replay
 * timeline footer.
 */
export function CopyResponseButton({
	className,
	text,
}: {
	className?: string;
	text: string;
}) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (resetTimer.current !== null) {
				window.clearTimeout(resetTimer.current);
			}
		},
		[],
	);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			if (resetTimer.current !== null) {
				window.clearTimeout(resetTimer.current);
			}
			resetTimer.current = window.setTimeout(
				() => setCopied(false),
				COPY_FEEDBACK_MS,
			);
		} catch {
			// Clipboard access denied — leave the icon unchanged.
		}
	};
	const Icon = copied ? CheckIcon : ClipboardIcon;
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						aria-label='Copy response'
						className={cn(
							'rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-secondary/60 hover:text-foreground',
							copied && 'text-status-ok',
							className,
						)}
						onClick={copy}
						type='button'
					>
						<Icon aria-hidden='true' className='size-3.5' />
					</button>
				</TooltipTrigger>
				<TooltipContent>Copy response</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
