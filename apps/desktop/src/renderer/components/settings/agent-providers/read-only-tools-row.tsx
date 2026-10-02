import { useQuery } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentProviderToolsQuery } from '@/renderer/api/ensemblr';
import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsErrorState } from '@/renderer/components/settings/settings-async-state';
import { StatusBadge } from '@/renderer/components/status-badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Switch } from '@/renderer/components/ui/switch';
import {
	claudeReadOnlyToolsAtom,
	piReadOnlyToolsAtom,
} from '@/renderer/state/preferences';
import { REPORT_TOOL_INVENTORY_LIMITS } from '@/shared/agent-control';
import type { AgentProviderId } from '@/shared/agent-provider';
import type { AgentProviderToolWire } from '@/shared/ipc/contracts/agent-provider';
import { acceptsUserTrust, CLAUDE_MCP_TOOL_NAME } from '@/shared/plan-mode';

/**
 * One line of the list: a reported tool, or a saved name nothing reported.
 * `applies` is false for a saved name main ignores because the app decides
 * about that tool itself, such as a hand-edited `bash` or Claude `Monitor`.
 */
interface ToolRowModel extends AgentProviderToolWire {
	applies: boolean;
	seen: boolean;
}

/** Why a hand-typed tool name was not saved. */
type AddToolRejection =
	| 'duplicate'
	| 'empty'
	| 'has-policy'
	| 'not-mcp'
	| 'too-long';

/**
 * Dedupes and sorts a list of tool names into a fresh array.
 * @param names - Names to normalize.
 * @returns The names once each, in name order.
 */
function normalizeToolNames(names: readonly string[]): string[] {
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Merges the runtime's reported tools with the names already saved, so a saved
 * name the runtime no longer reports keeps a row the user can switch off, and a
 * saved name main ignores says so rather than looking trusted.
 * @param discovered - Tools the runtime's sessions reported.
 * @param saved - Names the user already trusts.
 * @param provider - The runtime the list belongs to.
 * @returns One row per distinct name, sorted by name.
 */
function buildToolRows(
	discovered: readonly AgentProviderToolWire[],
	saved: readonly string[],
	provider: AgentProviderId,
): ToolRowModel[] {
	const seen = new Set(discovered.map((tool) => tool.name));
	const unseen = saved
		.filter((name) => !seen.has(name))
		.map(
			(name): ToolRowModel => ({
				applies: acceptsUserTrust(name, provider),
				description: null,
				name,
				refused: false,
				seen: false,
				source: null,
			}),
		);
	return [
		...discovered.map((tool) => ({ ...tool, applies: true, seen: true })),
		...unseen,
	].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Checks a hand-typed tool name against what a user may vouch for on the
 * runtime. On Claude Code only an MCP tool can be trusted, so a name of any
 * other shape is told so rather than being told it already has a rule.
 * @param name - The trimmed name.
 * @param saved - Names the user already trusts.
 * @param provider - The runtime the list belongs to.
 * @returns The reason it cannot be saved, or null when it can.
 */
function rejectToolName(
	name: string,
	saved: readonly string[],
	provider: AgentProviderId,
): AddToolRejection | null {
	if (name.length === 0) return 'empty';
	if (saved.includes(name)) return 'duplicate';
	if (name.length > REPORT_TOOL_INVENTORY_LIMITS.maxNameLength) {
		return 'too-long';
	}
	if (provider === 'claude' && !CLAUDE_MCP_TOOL_NAME.test(name)) {
		return 'not-mcp';
	}
	return acceptsUserTrust(name, provider) ? null : 'has-policy';
}

/**
 * One tool: its name, where it came from, a one-line description, and the
 * switch that trusts it.
 */
function ToolRow({
	onToggle,
	reported,
	tool,
	trusted,
}: {
	onToggle: (name: string, trusted: boolean) => void;
	reported: boolean;
	tool: ToolRowModel;
	trusted: boolean;
}) {
	const { t } = useTranslation();
	const source =
		tool.source ??
		(reported && !tool.seen
			? t(
					'settings:providers.read-only-tools.not-seen',
					'Not seen since launch',
				)
			: null);

	return (
		<li className='flex items-center gap-3 px-3 py-2'>
			<div className='min-w-0 flex-1 space-y-0.5'>
				<div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
					<code className='truncate font-mono text-foreground text-xs'>
						{tool.name}
					</code>
					{source ? (
						<span className='text-muted-foreground text-xxs'>{source}</span>
					) : null}
					{tool.refused && !trusted ? (
						<StatusBadge tone='warning'>
							{t('settings:providers.read-only-tools.refused', 'Refused')}
						</StatusBadge>
					) : null}
				</div>
				{tool.applies ? null : (
					<p className='text-status-warning text-xs'>
						{t(
							'settings:providers.read-only-tools.not-applied',
							'Ignored: Ensemblr decides about this tool itself.',
						)}
					</p>
				)}
				{tool.description ? (
					<p className='truncate text-muted-foreground text-xs'>
						{tool.description}
					</p>
				) : null}
			</div>
			<Switch
				aria-label={t(
					'settings:providers.read-only-tools.trust-aria',
					'Trust {{name}} as read-only',
					{ name: tool.name },
				)}
				checked={trusted}
				onCheckedChange={(next) => onToggle(tool.name, next)}
				size='sm'
			/>
		</li>
	);
}

/**
 * The add-by-hand field: trims what was typed, refuses names that cannot be
 * trusted or already are, and hands an accepted name to the caller.
 */
function AddToolForm({
	onAdd,
	provider,
	saved,
}: {
	onAdd: (name: string) => void;
	provider: AgentProviderId;
	saved: readonly string[];
}) {
	const { t } = useTranslation();
	const inputId = useId();
	const [draft, setDraft] = useState('');
	const [rejection, setRejection] = useState<AddToolRejection | null>(null);
	const name = draft.trim();

	/**
	 * Saves the typed name when it passes, or shows why it cannot be trusted.
	 * @param event - The form submission, held back from a page navigation.
	 */
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const reason = rejectToolName(name, saved, provider);
		setRejection(reason);
		if (reason) return;
		onAdd(name);
		setDraft('');
	};

	const messages: Record<AddToolRejection, string> = {
		duplicate: t(
			'settings:providers.read-only-tools.error.duplicate',
			'{{name}} is already trusted.',
			{ name },
		),
		empty: t(
			'settings:providers.read-only-tools.error.empty',
			'Enter a tool name.',
		),
		'has-policy': t(
			'settings:providers.read-only-tools.error.has-policy',
			'Ensemblr already has a rule for {{name}}, so it cannot be trusted here.',
			{ name },
		),
		'not-mcp': t(
			'settings:providers.read-only-tools.error.not-mcp',
			'On Claude Code only MCP tools can be trusted, named mcp__server__tool.',
		),
		'too-long': t(
			'settings:providers.read-only-tools.error.too-long',
			'Tool names are at most {{max}} characters long.',
			{ max: REPORT_TOOL_INVENTORY_LIMITS.maxNameLength },
		),
	};

	return (
		<form className='space-y-1.5' onSubmit={submit}>
			<div className='flex items-center gap-2'>
				<Input
					aria-describedby={rejection ? `${inputId}-error` : undefined}
					aria-invalid={rejection !== null}
					aria-label={t(
						'settings:providers.read-only-tools.add-aria',
						'Tool name to trust',
					)}
					className='font-mono'
					id={inputId}
					onChange={(event) => {
						setDraft(event.target.value);
						setRejection(null);
					}}
					placeholder={t(
						'settings:providers.read-only-tools.add-placeholder',
						'Tool name',
					)}
					value={draft}
				/>
				<Button size='sm' type='submit' variant='outline'>
					{t('settings:providers.read-only-tools.add', 'Add')}
				</Button>
			</div>
			{rejection ? (
				<p
					className='text-status-danger text-xs'
					id={`${inputId}-error`}
					role='alert'
				>
					{messages[rejection]}
				</p>
			) : null}
		</form>
	);
}

/**
 * Lists the extra tools one runtime holds and lets the user vouch for each as
 * read-only, so Plan Mode and the Concierge stop refusing it. The list is the
 * union of what the runtime's sessions reported since launch and the names
 * already saved; a name can also be typed by hand for a tool no session has
 * reported yet. Writes go through the app-settings atom as a fresh, sorted,
 * deduped array.
 */
export function ReadOnlyToolsRow({ provider }: { provider: AgentProviderId }) {
	const { t } = useTranslation();
	const [saved, setSaved] = useAtom(
		provider === 'pi' ? piReadOnlyToolsAtom : claudeReadOnlyToolsAtom,
	);
	const inventory = useQuery(agentProviderToolsQuery(provider));
	const reported = inventory.data?.reported ?? false;
	const rows = buildToolRows(inventory.data?.tools ?? [], saved, provider);
	const savedNames = new Set(saved);

	/**
	 * Adds a tool to the saved list or takes it off, as the row's switch says.
	 * @param name - The tool the switch belongs to.
	 * @param trusted - Whether the switch was turned on.
	 */
	const toggle = (name: string, trusted: boolean) =>
		setSaved((current) =>
			normalizeToolNames(
				trusted ? [...current, name] : current.filter((n) => n !== name),
			),
		);
	/**
	 * Saves a name typed by hand.
	 * @param name - The trimmed name the add form accepted.
	 */
	const add = (name: string) =>
		setSaved((current) => normalizeToolNames([...current, name]));

	return (
		<SettingRow
			description={t(
				'settings:providers.read-only-tools.description',
				'Plan Mode and the Concierge refuse tools Ensemblr cannot vouch for. Trust a tool here only if it cannot change files, run commands, or act on your accounts.',
			)}
			label={t('settings:providers.read-only-tools.label', 'Read-only tools')}
			stack
		>
			<div className='space-y-3'>
				{inventory.isError ? (
					<SettingsErrorState
						className='py-2'
						message={t(
							'settings:providers.read-only-tools.load-failed',
							'Ensemblr could not read this runtime’s tools.',
						)}
						onRetry={() => void inventory.refetch()}
					/>
				) : null}
				{rows.length > 0 ? (
					<ul className='divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40'>
						{rows.map((tool) => (
							<ToolRow
								key={tool.name}
								onToggle={toggle}
								reported={reported}
								tool={tool}
								trusted={savedNames.has(tool.name)}
							/>
						))}
					</ul>
				) : null}
				{rows.length === 0 && inventory.isSuccess ? (
					<p className='text-muted-foreground text-xs'>
						{reported
							? t(
									'settings:providers.read-only-tools.empty',
									'No extra tools found.',
								)
							: t(
									'settings:providers.read-only-tools.not-reported',
									'Start a conversation on this runtime to list the extra tools it holds.',
								)}
					</p>
				) : null}
				<AddToolForm onAdd={add} provider={provider} saved={saved} />
			</div>
		</SettingRow>
	);
}
