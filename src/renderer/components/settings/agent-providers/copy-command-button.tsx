import { CheckIcon, ClipboardIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { useCopyToClipboard } from '@/renderer/hooks/use-copy-to-clipboard';

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
	const { t } = useTranslation();
	const { copied, copy } = useCopyToClipboard(COPIED_FLASH_MS);
	const Icon = copied ? CheckIcon : ClipboardIcon;

	return (
		<Button
			data-copy-command={command}
			onClick={() => {
				void copy(command);
			}}
			size='xs'
			type='button'
			variant='outline'
		>
			<Icon aria-hidden='true' data-icon='inline-start' />
			{copied ? t('common:actions.copied', 'Copied') : label}
		</Button>
	);
}
