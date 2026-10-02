import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/renderer/lib/utils';
import { BlockControlButton } from './block-controls';

const COPY_FEEDBACK_MS = 1500;

/**
 * Writes a payload to the clipboard, preferring the rich flavor when one is
 * offered so a paste into an editor or a spreadsheet keeps the structure the
 * plain-text flavor can only approximate.
 * @param payload - Plain text to copy, plus an optional HTML flavor
 */
async function writeToClipboard(payload: { html?: string; text: string }) {
	if (payload.html && typeof ClipboardItem !== 'undefined') {
		await navigator.clipboard.write([
			new ClipboardItem({
				'text/html': new Blob([payload.html], { type: 'text/html' }),
				'text/plain': new Blob([payload.text], { type: 'text/plain' }),
			}),
		]);
		return;
	}
	await navigator.clipboard.writeText(payload.text);
}

/**
 * Icon-only clipboard button that copies the given text and flips to a check
 * for ~1.5s on success. Shared by the assistant turn footer, the replay
 * timeline footer, and the hover control on code surfaces and answer tables.
 */
export function CopyResponseButton({
	className,
	label,
	text,
}: {
	className?: string;
	/** Names what is copied, for the tooltip and the accessible label. */
	label?: string;
	/** The text itself, or a getter run on click when it has to be read back from the DOM. */
	text: string | (() => { html?: string; text: string });
}) {
	const { t } = useTranslation();
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
			await writeToClipboard(typeof text === 'string' ? { text } : text());
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
	const Icon = copied ? CheckIcon : CopyIcon;
	return (
		<BlockControlButton
			className={cn(copied && 'text-status-ok opacity-100', className)}
			label={label ?? t('common:actions.copy-response', 'Copy response')}
			onClick={copy}
		>
			<Icon aria-hidden='true' className='size-3.5' />
		</BlockControlButton>
	);
}
