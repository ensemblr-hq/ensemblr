import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Input } from '@/renderer/components/ui/input';
import { Switch } from '@/renderer/components/ui/switch';
import { endpointSafety } from '@/renderer/lib/dictation';
import {
	dictationBaseUrlAtom,
	dictationEnabledAtom,
	dictationModelAtom,
} from '@/renderer/state/preferences';
import { formatShortcut } from '@/shared/keymap';
import { DictationApiKeyRow } from './dictation-api-key-row';

/** Chord that toggles the composer's mic control, named in the enable row. */
const DICTATION_SHORTCUT = formatShortcut('composer.toggleDictation');

/**
 * Settings for composer voice dictation: the master switch, the
 * OpenAI-compatible endpoint and model to transcribe against, and the API key.
 *
 * The endpoint is free text rather than a provider list because every
 * OpenAI-compatible transcription API — OpenAI itself, Groq, a locally-run
 * `whisper-server` — is reachable by changing this one value.
 */
export function DictationSection() {
	const { t } = useTranslation();
	const [enabled, setEnabled] = useAtom(dictationEnabledAtom);
	const [baseUrl, setBaseUrl] = useAtom(dictationBaseUrlAtom);
	const [model, setModel] = useAtom(dictationModelAtom);
	const safety = endpointSafety(baseUrl);

	return (
		<SettingsSection
			description={t(
				'settings:dictation.description',
				'Speak a prompt into the composer. Ensemblr records while you hold the control open, then sends the clip to the transcription service you configure here. English only for now.',
			)}
			title={t('settings:dictation.title', 'Dictation')}
		>
			<SettingRow
				control={<Switch checked={enabled} onCheckedChange={setEnabled} />}
				description={t(
					'settings:dictation.enabled.description',
					'Shows a microphone in the composer control row, toggled with {{shortcut}}. It stays hidden until an API key is stored.',
					{ shortcut: DICTATION_SHORTCUT },
				)}
				label={t('settings:dictation.enabled.label', 'Enable dictation')}
			/>
			{enabled ? (
				<>
					<SettingRow
						control={
							<Input
								className='w-64'
								onChange={(event) => setBaseUrl(event.target.value)}
								spellCheck={false}
								value={baseUrl}
							/>
						}
						description={t(
							'settings:dictation.base-url.description',
							'Root of an OpenAI-compatible API. Ensemblr posts to its /audio/transcriptions path.',
						)}
						label={t('settings:dictation.base-url.label', 'API endpoint')}
					>
						{safety === 'insecure' ? (
							<p className='text-status-warning text-xs'>
								{t(
									'settings:dictation.base-url.insecure',
									'This address is not encrypted, so your API key would be sent over the network in the clear. Use https, or a local address.',
								)}
							</p>
						) : null}
						{safety === 'invalid' ? (
							<p className='text-status-danger text-xs'>
								{t(
									'settings:dictation.base-url.invalid',
									'Enter a full address starting with https:// or http://.',
								)}
							</p>
						) : null}
					</SettingRow>
					<SettingRow
						control={
							<Input
								className='w-64'
								onChange={(event) => setModel(event.target.value)}
								spellCheck={false}
								value={model}
							/>
						}
						description={t(
							'settings:dictation.model.description',
							'Transcription model id, for example gpt-4o-mini-transcribe or whisper-large-v3-turbo.',
						)}
						label={t('settings:dictation.model.label', 'Model')}
					/>
					<DictationApiKeyRow />
				</>
			) : null}
		</SettingsSection>
	);
}
