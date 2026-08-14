import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	clearDictationApiKey,
	dictationKeyStatusQuery,
	ensemblrQueryKeys,
	setDictationApiKey,
} from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Spinner } from '@/renderer/components/ui/spinner';
import { failureText } from '@/renderer/lib/failure-text';
import type { DictationKeyMutationResult } from '@/shared/ipc/contracts/dictation';

/**
 * Stores, replaces, and removes the transcription provider's API key. The key
 * itself never comes back across the bridge — the row reads only whether one is
 * on file and the store's own masked tail, so a stored key cannot be read out of
 * the UI by anything that reaches the renderer.
 */
export function DictationApiKeyRow() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: keyStatus, isLoading } = useQuery(dictationKeyStatusQuery);
	const [draftKey, setDraftKey] = useState('');
	const [editing, setEditing] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	/** Refreshes the stored-key status and reports any failure the write returned. */
	const settle = async (result: DictationKeyMutationResult | undefined) => {
		setFailure(
			result?.status === 'error' ? failureText(t, result.failure) : null,
		);
		await queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.dictationKeyStatus(),
		});
	};

	const save = useMutation({
		mutationFn: () => setDictationApiKey(draftKey),
		onSettled: async (result) => {
			if (result?.status === 'ok') {
				setDraftKey('');
				setEditing(false);
			}
			await settle(result);
		},
	});

	const remove = useMutation({
		mutationFn: clearDictationApiKey,
		onSettled: settle,
	});

	const configured = keyStatus?.configured ?? false;
	// A store that cannot be read is not the same answer as no key stored, and
	// the mic stays hidden either way — so the reason has to be on screen.
	const message = failure ?? failureText(t, keyStatus?.failure);

	return (
		<SettingRow
			control={
				isLoading ? (
					<Spinner className='size-4' />
				) : (
					<div className='flex items-center gap-2'>
						{editing || !configured ? (
							<>
								<Input
									autoComplete='off'
									className='w-64'
									onChange={(event) => setDraftKey(event.target.value)}
									placeholder={t(
										'settings:dictation.api-key.placeholder',
										'Paste your API key',
									)}
									type='password'
									value={draftKey}
								/>
								<Button
									disabled={draftKey.trim().length === 0 || save.isPending}
									onClick={() => save.mutate()}
									size='sm'
								>
									{t('common:actions.save', 'Save')}
								</Button>
								{configured ? (
									<Button
										onClick={() => {
											setDraftKey('');
											setEditing(false);
										}}
										size='sm'
										variant='ghost'
									>
										{t('common:actions.cancel', 'Cancel')}
									</Button>
								) : null}
							</>
						) : (
							<>
								<code className='text-muted-foreground text-xs'>
									{keyStatus?.maskedKey}
								</code>
								<Button
									onClick={() => setEditing(true)}
									size='sm'
									variant='outline'
								>
									{t('settings:dictation.api-key.replace', 'Replace')}
								</Button>
								<Button
									disabled={remove.isPending}
									onClick={() => remove.mutate()}
									size='sm'
									variant='ghost'
								>
									{t('common:actions.remove', 'Remove')}
								</Button>
							</>
						)}
					</div>
				)
			}
			description={t(
				'settings:dictation.api-key.description',
				'Stored in the macOS Keychain, never in a config file. Ensemblr sends it only to the endpoint above.',
			)}
			label={t('settings:dictation.api-key.label', 'API key')}
		>
			{message ? <p className='text-status-danger text-xs'>{message}</p> : null}
		</SettingRow>
	);
}
