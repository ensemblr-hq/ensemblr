import { KeyRoundIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';

/**
 * Masked field floated over a Setup or Run pane while its script is blocked on
 * a password prompt. Those panes refuse keyboard input, so this is the one way
 * to answer `sudo`: the value goes straight to the script's PTY followed by
 * Enter, and is cleared from the field the moment it is sent. It never takes
 * focus on its own — a chat draft typed into it by accident would be handed to
 * the script as a password.
 */
export function SecretPromptBar({
	prompt,
	terminalId,
}: {
	/** The prompt line exactly as the script printed it. */
	prompt: string;
	terminalId: string;
}) {
	const { t } = useTranslation();
	const [secret, setSecret] = useState('');
	const [sendFailed, setSendFailed] = useState(false);

	/**
	 * Hands the typed password to the script and clears the field, reporting a
	 * failed send inline so the user knows to answer again.
	 * @param event - The form submission, whose default navigation is suppressed.
	 */
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const answer = secret;
		setSecret('');
		setSendFailed(false);
		Promise.resolve(
			window.ensemblr?.writeTerminalSession({
				data: `${answer}\r`,
				terminalId,
			}),
		).catch(() => {
			setSendFailed(true);
		});
	};

	return (
		<form
			className='absolute inset-x-2 top-2 z-10 flex flex-col gap-1.5 rounded-lg border bg-background/95 p-2 shadow-sm'
			onSubmit={handleSubmit}
		>
			<div className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'>
				<KeyRoundIcon aria-hidden className='size-3.5 shrink-0' />
				<span className='shrink-0'>
					{t(
						'workbench:secret-prompt.heading',
						'Script is waiting for a password',
					)}
				</span>
				<span className='min-w-0 truncate font-mono' title={prompt}>
					{prompt}
				</span>
			</div>
			<div className='flex items-center gap-1.5'>
				<Input
					aria-label={t('workbench:secret-prompt.input-label', 'Password')}
					autoComplete='off'
					className='h-7 font-mono'
					onChange={(event) => setSecret(event.target.value)}
					spellCheck={false}
					type='password'
					value={secret}
				/>
				<Button size='sm' type='submit'>
					{t('workbench:secret-prompt.send', 'Send')}
				</Button>
			</div>
			{sendFailed ? (
				<p className='text-destructive text-xs' role='alert'>
					{t(
						'workbench:secret-prompt.send-failed',
						'Could not reach the script. Try again.',
					)}
				</p>
			) : null}
		</form>
	);
}
