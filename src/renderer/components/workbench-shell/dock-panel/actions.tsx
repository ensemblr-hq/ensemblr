import {
	ChevronDownIcon,
	ExternalLinkIcon,
	SettingsIcon,
	SquareIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { RunScriptIcon } from '@/renderer/components/run-script-icon';
import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import {
	type PreviewUrlOption,
	resolvePreviewUrlOptions,
} from '@/renderer/lib/workbench/preview-urls';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import { formatShortcut } from '@/shared/keymap';
import {
	formatRunScriptLabel,
	type RunScriptDefinition,
} from '@/shared/scripts';

/**
 * Renders the run-script button cluster on the dock header. Setup controls live
 * in the Setup dock tab, not here — the tab row is reserved for run actions.
 * Below the `md` dock-header container width the buttons collapse to icons to
 * leave room for tabs; the Open control keeps its `:port` label.
 */
export function DockPanelActions({
	actions,
	activeRunScript,
	workspace,
}: {
	actions: WorkbenchDockActions;
	/** Script the Run button targets, or null when the repository configures none. */
	activeRunScript: RunScriptDefinition | null;
	workspace: WorkspaceShellModel;
}) {
	const { t } = useTranslation();
	const { run } = workspace.scripts;

	if (run.status === 'running') {
		const previewOptions = resolvePreviewUrlOptions({
			configured: workspace.configuredPreviewUrls ?? [],
			detectedUrl: run.previewUrl ?? null,
			port: typeof run.port === 'number' ? run.port : null,
			workspaceName: workspace.name,
		});

		return (
			<>
				<OpenPreviewControl
					onOpen={actions.onOpenRunPort}
					options={previewOptions}
					port={typeof run.port === 'number' ? run.port : null}
				/>
				<Button
					aria-label={t('workbench:run-script.stop-label', 'Stop run script')}
					onClick={actions.onStopRunScript}
					size='xs'
					variant='outline'
				>
					<SquareIcon data-icon='inline-start' />
					<span className='@max-md/dock-header:hidden whitespace-nowrap'>
						{t('common:actions.stop', 'Stop')}
					</span>
					<RunShortcutHint />
				</Button>
			</>
		);
	}

	if (activeRunScript) {
		return (
			<RunScriptControl
				active={activeRunScript}
				onConfigure={actions.onOpenSetupScripts}
				onRun={actions.onRunScript}
				scripts={workspace.runScripts}
			/>
		);
	}

	// Nothing runnable in this state: the tab row carries only run/stop and open
	// actions. The Setup Scripts entry point lives in the Setup dock tab and its
	// settings page, not the header.
	return null;
}

/**
 * The ⌘R hint the run and stop buttons carry. Drops out below the `lg` dock
 * header width, one step after the text label, so the shortcut is the first
 * thing sacrificed when the tab row needs the room.
 */
function RunShortcutHint() {
	return (
		<span
			aria-hidden='true'
			className='@max-lg/dock-header:hidden text-muted-foreground'
		>
			{formatShortcut('run.start')}
		</span>
	);
}

/**
 * Run control for the dock header: a plain button when the repository declares
 * one script, or a split button whose dropdown lists every script plus a
 * Configure shortcut when it declares several. The primary action always runs
 * the active script, which is what ⌘R targets.
 */
function RunScriptControl({
	active,
	onConfigure,
	onRun,
	scripts,
}: {
	active: RunScriptDefinition;
	onConfigure: () => void;
	onRun: (scriptName: string) => void;
	scripts: readonly RunScriptDefinition[];
}) {
	const { t } = useTranslation();
	const label = formatRunScriptLabel(active.name);
	const primary = (
		<Button
			aria-label={t('workbench:run-script.run-label', 'Run {{script}}', {
				script: label,
			})}
			className={scripts.length > 1 ? 'rounded-r-none' : undefined}
			onClick={() => onRun(active.name)}
			size='xs'
			variant='outline'
		>
			<RunScriptIcon data-icon='inline-start' name={active.icon} />
			<span className='@max-md/dock-header:hidden whitespace-nowrap'>
				{label}
			</span>
			<RunShortcutHint />
		</Button>
	);

	if (scripts.length <= 1) {
		return primary;
	}

	return (
		<div className='flex items-center'>
			{primary}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label={t('workbench:run-script.choose', 'Choose run script')}
						className='rounded-l-none border-l-0 px-1'
						size='xs'
						variant='outline'
					>
						<ChevronDownIcon className='size-3' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					{scripts.map((script) => (
						<DropdownMenuItem
							className='whitespace-nowrap'
							key={script.name}
							onSelect={() => onRun(script.name)}
						>
							<RunScriptIcon name={script.icon} />
							{formatRunScriptLabel(script.name)}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className='whitespace-nowrap'
						onSelect={onConfigure}
					>
						<SettingsIcon />
						{t('common:actions.configure', 'Configure')}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * Renders the dock Open control: a single button when one preview URL applies,
 * or a split button with a dropdown of the configured URLs when several do. The
 * first option is the default action. Renders nothing when no preview URL is
 * configured or auto-detected yet. Collapses to an icon at narrow dock-header
 * widths, but always keeps the `:port` label so the port stays visible.
 */
function OpenPreviewControl({
	onOpen,
	options,
	port,
}: {
	onOpen: (url: string) => void;
	options: PreviewUrlOption[];
	port: number | null;
}) {
	const { t } = useTranslation();
	const primary = options[0];

	if (!primary) {
		return null;
	}

	if (options.length === 1) {
		return (
			<Button
				aria-label={
					port !== null
						? t(
								'workbench:preview.open-port',
								'Open preview on port {{port}}',
								{
									port,
								},
							)
						: t('workbench:preview.open-named', 'Open {{name}}', {
								name: primary.name,
							})
				}
				onClick={() => onOpen(primary.url)}
				size='xs'
				variant='outline'
			>
				<ExternalLinkIcon data-icon='inline-start' />
				{port !== null ? (
					<>
						<span className='@max-md/dock-header:hidden'>
							{t('workbench:preview.open-port-label', 'Open :{{port}}', {
								port,
							})}
						</span>
						<span className='@max-md/dock-header:inline hidden'>:{port}</span>
					</>
				) : (
					<span className='@max-md/dock-header:hidden'>{primary.name}</span>
				)}
			</Button>
		);
	}

	return (
		<OpenPreviewSplit onOpen={onOpen} options={options} primary={primary} />
	);
}

/** Split Open button: primary opens the first URL, the dropdown lists the rest. */
function OpenPreviewSplit({
	onOpen,
	options,
	primary,
}: {
	onOpen: (url: string) => void;
	options: PreviewUrlOption[];
	primary: PreviewUrlOption;
}) {
	const { t } = useTranslation();

	return (
		<div className='flex items-center'>
			<Button
				aria-label={t('workbench:preview.open-named', 'Open {{name}}', {
					name: primary.name,
				})}
				className='rounded-r-none'
				onClick={() => onOpen(primary.url)}
				size='xs'
				variant='outline'
			>
				<ExternalLinkIcon data-icon='inline-start' />
				<span className='@max-md/dock-header:hidden'>{primary.name}</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label={t('workbench:preview.choose-url', 'Choose preview URL')}
						className='rounded-l-none border-l-0 px-1'
						size='xs'
						variant='outline'
					>
						<ChevronDownIcon className='size-3' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					{options.map((option) => (
						<DropdownMenuItem
							key={`${option.name}:${option.url}`}
							onSelect={() => onOpen(option.url)}
						>
							{option.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
