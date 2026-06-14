import { useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import {
	BoxIcon,
	GitBranchIcon,
	HeartPulseIcon,
	KeyboardIcon,
	LayoutDashboardIcon,
	LinkIcon,
	PuzzleIcon,
	SettingsIcon,
	TerminalIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from '@/renderer/components/ui/command';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { themeAtom } from '@/renderer/state/preferences';
import { formatShortcut } from '@/shared/keymap';

interface ActionEntry {
	id: string;
	label: string;
	hint?: string;
	icon: React.ComponentType<{ className?: string }>;
	keywords?: string[];
	shortcutId?: 'palette.open' | 'settings.open' | 'sidebar.toggle';
	run: () => void;
}

/**
 * Global command palette. Triggered by Cmd+K from anywhere; exposes navigation,
 * settings sections, theme cycling, and Linear access in one searchable view.
 */
export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const [theme, setTheme] = useAtom(themeAtom);

	const openPalette = useCallback(() => setOpen(true), []);
	const close = useCallback(() => setOpen(false), []);

	useHotkey('palette.open', openPalette);
	useHotkey('settings.open', () => {
		close();
		navigate({ to: '/settings/general' });
	});

	const go = useCallback(
		(action: () => void) => () => {
			close();
			action();
		},
		[close],
	);

	const navigation: ActionEntry[] = [
		{
			id: 'go.home',
			label: 'Go to workbench',
			icon: LayoutDashboardIcon,
			run: go(() => navigate({ to: '/' })),
			shortcutId: 'sidebar.toggle',
		},
		{
			id: 'go.linear',
			label: 'Browse Linear issues',
			icon: LinkIcon,
			run: go(() => navigate({ to: '/linear' })),
		},
		{
			id: 'go.history',
			label: 'Open chat history',
			icon: LayoutDashboardIcon,
			run: go(() => navigate({ to: '/history' })),
		},
		{
			id: 'go.help',
			label: 'Open help',
			icon: LayoutDashboardIcon,
			run: go(() => navigate({ to: '/help' })),
		},
	];

	const settings: ActionEntry[] = [
		{
			id: 'settings.general',
			label: 'Settings · General',
			icon: SettingsIcon,
			run: go(() => navigate({ to: '/settings/general' })),
			shortcutId: 'settings.open',
		},
		{
			id: 'settings.models',
			label: 'Settings · Models',
			icon: BoxIcon,
			run: go(() => navigate({ to: '/settings/models' })),
		},
		{
			id: 'settings.providers',
			label: 'Settings · Providers',
			icon: PuzzleIcon,
			run: go(() => navigate({ to: '/settings/providers' })),
		},
		{
			id: 'settings.environment',
			label: 'Settings · Environment',
			icon: KeyboardIcon,
			run: go(() => navigate({ to: '/settings/environment' })),
		},
		{
			id: 'settings.git',
			label: 'Settings · Git',
			icon: GitBranchIcon,
			run: go(() => navigate({ to: '/settings/git' })),
		},
		{
			id: 'settings.appearance',
			label: 'Settings · Appearance',
			icon: SettingsIcon,
			run: go(() => navigate({ to: '/settings/appearance' })),
		},
		{
			id: 'settings.integrations',
			label: 'Settings · Integrations',
			icon: PuzzleIcon,
			run: go(() => navigate({ to: '/settings/integrations' })),
		},
		{
			id: 'settings.diagnostics',
			label: 'Settings · Diagnostics',
			icon: HeartPulseIcon,
			run: go(() => navigate({ to: '/settings/diagnostics' })),
		},
		{
			id: 'settings.experimental',
			label: 'Settings · Experimental',
			icon: TerminalIcon,
			run: go(() => navigate({ to: '/settings/experimental' })),
		},
		{
			id: 'settings.advanced',
			label: 'Settings · Advanced',
			icon: TerminalIcon,
			run: go(() => navigate({ to: '/settings/advanced' })),
		},
	];

	const appearance: ActionEntry[] = [
		{
			id: 'theme.system',
			label: 'Theme · System',
			icon: SettingsIcon,
			keywords: ['light', 'dark'],
			run: go(() => setTheme('system')),
		},
		{
			id: 'theme.light',
			label: 'Theme · Light',
			icon: SettingsIcon,
			run: go(() => setTheme('light')),
		},
		{
			id: 'theme.dark',
			label: 'Theme · Dark',
			icon: SettingsIcon,
			run: go(() => setTheme('dark')),
		},
	];

	return (
		<CommandDialog onOpenChange={setOpen} open={open}>
			<Command label='Command palette'>
				<CommandInput placeholder='Search commands…' />
				<CommandList>
					<CommandEmpty>No matching command.</CommandEmpty>
					<ActionGroup
						actions={navigation}
						currentTheme={theme}
						heading='Navigation'
					/>
					<CommandSeparator />
					<ActionGroup
						actions={settings}
						currentTheme={theme}
						heading='Settings'
					/>
					<CommandSeparator />
					<ActionGroup
						actions={appearance}
						currentTheme={theme}
						heading='Appearance'
					/>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}

function ActionGroup({
	actions,
	currentTheme,
	heading,
}: {
	actions: ActionEntry[];
	currentTheme: string;
	heading: string;
}) {
	return (
		<CommandGroup heading={heading}>
			{actions.map((action) => {
				const Icon = action.icon;
				const isThemeActive = action.id === `theme.${currentTheme}`;
				return (
					<CommandItem
						data-checked={isThemeActive ? 'true' : undefined}
						key={action.id}
						keywords={action.keywords}
						onSelect={action.run}
						value={`${heading} ${action.label}`}
					>
						<Icon className='size-4 text-muted-foreground' />
						<span>{action.label}</span>
						{action.hint ? (
							<span className='ml-1 text-muted-foreground text-xs'>
								{action.hint}
							</span>
						) : null}
						{action.shortcutId ? (
							<CommandShortcut>
								{formatShortcut(action.shortcutId)}
							</CommandShortcut>
						) : null}
					</CommandItem>
				);
			})}
		</CommandGroup>
	);
}
