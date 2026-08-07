import { CheckIcon, ClipboardIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/renderer/components/ui/button';

/** How long the button reads "Copied" before reverting to its label. */
const COPIED_FLASH_MS = 1800;

/**
 * Copies a shell command to the clipboard and flashes a confirmation — it never
 * executes anything. Provider sign-in (`claude /login`) is an interactive OAuth
 * flow that cannot work in a non-TTY child, so the page hands the user the
 * command instead of spawning it.
 */
export function CopyCommandButton({
	command,
	label,
}: {
	command: string;
	label: string;
}) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
		} catch (error) {
			console.error('Failed to copy command to clipboard:', error);
			return;
		}
		setCopied(true);
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			setCopied(false);
		}, COPIED_FLASH_MS);
	};

	const Icon = copied ? CheckIcon : ClipboardIcon;

	return (
		<Button
			data-copy-command={command}
			onClick={() => {
				void copy();
			}}
			size='xs'
			type='button'
			variant='outline'
		>
			<Icon aria-hidden='true' data-icon='inline-start' />
			{copied ? 'Copied' : label}
		</Button>
	);
}
