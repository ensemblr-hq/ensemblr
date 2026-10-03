import { useAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Input } from '@/renderer/components/ui/input';
import { Switch } from '@/renderer/components/ui/switch';
import { Textarea } from '@/renderer/components/ui/textarea';
import {
	computeQueueConcurrencyAtom,
	computeQueueEnabledAtom,
	computeQueueExemptPatternsAtom,
	computeQueueExtraPatternsAtom,
	computeQueueNicenessAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

/** Factory defaults; a row shows its "modified" accent when its value differs. */
const DEFAULTS = DEFAULT_APP_SETTINGS.computeQueue;
const MAX_CONCURRENCY = 16;
const MAX_NICENESS = 19;

/**
 * Splits a text area's content into patterns: one per line, trimmed, empties
 * dropped.
 * @param text - Raw text area content
 * @returns The non-empty trimmed lines
 */
function parsePatterns(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Clamps typed input to an integer in range, falling back to the minimum for
 * anything that is not a number.
 * @param raw - The input's string value
 * @param min - Lowest accepted value
 * @param max - Highest accepted value
 * @returns An integer within `min`..`max`
 */
function clampInteger(raw: string, min: number, max: number): number {
	const parsed = Math.trunc(Number(raw));
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
}

/** One numeric row of the compute queue section. */
function NumberSettingRow({
	ariaLabel,
	defaultValue,
	description,
	label,
	max,
	min,
	onChange,
	value,
}: {
	ariaLabel: string;
	defaultValue: number;
	description: string;
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	value: number;
}) {
	return (
		<SettingRow
			control={
				<Input
					aria-label={ariaLabel}
					className='h-7 w-20 text-right font-mono text-xs'
					max={max}
					min={min}
					onChange={(e) => onChange(clampInteger(e.target.value, min, max))}
					type='number'
					value={value}
				/>
			}
			description={description}
			label={label}
			modified={value !== defaultValue}
			onReset={() => onChange(defaultValue)}
		/>
	);
}

/** One pattern-list row: a text area committed on blur as trimmed lines. */
function PatternListRow({
	ariaLabel,
	description,
	label,
	onChange,
	patterns,
	placeholder,
}: {
	ariaLabel: string;
	description: string;
	label: string;
	onChange: (patterns: string[]) => void;
	patterns: readonly string[];
	placeholder: string;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const shown = draft ?? patterns.join('\n');

	return (
		<SettingRow
			description={description}
			label={label}
			modified={patterns.length > 0}
			onReset={() => {
				setDraft(null);
				onChange([]);
			}}
			stack
		>
			<Textarea
				aria-label={ariaLabel}
				className='mt-2 min-h-16 font-mono text-xs'
				onBlur={() => {
					if (draft !== null) {
						onChange(parsePatterns(draft));
						setDraft(null);
					}
				}}
				onChange={(e) => setDraft(e.target.value)}
				placeholder={placeholder}
				rows={3}
				spellCheck={false}
				value={shown}
			/>
		</SettingRow>
	);
}

/**
 * The Settings → General rows for the app-wide compute queue: whether heavy
 * agent commands wait for a slot, how many run at once, how politely they run,
 * and which commands count as heavy.
 */
export function ComputeQueueRows() {
	const { t } = useTranslation();
	const [enabled, setEnabled] = useAtom(computeQueueEnabledAtom);
	const [concurrency, setConcurrency] = useAtom(computeQueueConcurrencyAtom);
	const [niceness, setNiceness] = useAtom(computeQueueNicenessAtom);
	const [extraPatterns, setExtraPatterns] = useAtom(
		computeQueueExtraPatternsAtom,
	);
	const [exemptPatterns, setExemptPatterns] = useAtom(
		computeQueueExemptPatternsAtom,
	);

	return (
		<>
			<SettingRow
				control={<Switch checked={enabled} onCheckedChange={setEnabled} />}
				description={t(
					'settings:general.compute-queue.enabled.description',
					'Heavy commands agents run, such as builds, tests, and installs, wait for a free slot across all workspaces instead of starting together. Keeps the machine responsive when several agents work at once.',
				)}
				label={t(
					'settings:general.compute-queue.enabled.label',
					'Compute queue',
				)}
				modified={enabled !== DEFAULTS.enabled}
				onReset={() => setEnabled(DEFAULTS.enabled)}
			/>
			<NumberSettingRow
				ariaLabel={t(
					'settings:general.compute-queue.concurrency.aria-label',
					'Compute queue slots',
				)}
				defaultValue={DEFAULTS.concurrency}
				description={t(
					'settings:general.compute-queue.concurrency.description',
					'How many queued commands may run at the same time. Scripts you start yourself always run at once and hold a slot.',
				)}
				label={t(
					'settings:general.compute-queue.concurrency.label',
					'Concurrent slots',
				)}
				max={MAX_CONCURRENCY}
				min={1}
				onChange={setConcurrency}
				value={concurrency}
			/>
			<NumberSettingRow
				ariaLabel={t(
					'settings:general.compute-queue.niceness.aria-label',
					'Compute queue CPU priority',
				)}
				defaultValue={DEFAULTS.niceness}
				description={t(
					'settings:general.compute-queue.niceness.description',
					'CPU priority of queued commands, from 0 to 19. A higher value yields more CPU to your own apps.',
				)}
				label={t(
					'settings:general.compute-queue.niceness.label',
					'CPU priority (niceness)',
				)}
				max={MAX_NICENESS}
				min={0}
				onChange={setNiceness}
				value={niceness}
			/>
			<PatternListRow
				ariaLabel={t(
					'settings:general.compute-queue.extra-patterns.aria-label',
					'Extra heavy command patterns, one per line',
				)}
				description={t(
					'settings:general.compute-queue.extra-patterns.description',
					'Commands to queue in addition to the built-in list, one pattern per line. A pattern is a command prefix split on spaces; * matches within a word. Package scripts match as run <script>, for example run test*.',
				)}
				label={t(
					'settings:general.compute-queue.extra-patterns.label',
					'Extra heavy commands',
				)}
				onChange={setExtraPatterns}
				patterns={extraPatterns}
				placeholder='cargo build*'
			/>
			<PatternListRow
				ariaLabel={t(
					'settings:general.compute-queue.exempt-patterns.aria-label',
					'Exempt command patterns, one per line',
				)}
				description={t(
					'settings:general.compute-queue.exempt-patterns.description',
					'Commands that never wait in the queue, one pattern per line, using the same syntax. Exemptions win over heavy patterns.',
				)}
				label={t(
					'settings:general.compute-queue.exempt-patterns.label',
					'Exempt commands',
				)}
				onChange={setExemptPatterns}
				patterns={exemptPatterns}
				placeholder='run lint*'
			/>
		</>
	);
}
