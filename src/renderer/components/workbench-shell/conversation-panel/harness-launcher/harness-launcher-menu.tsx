import { Icon } from '@iconify/react';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { BotIcon, LoaderCircleIcon } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import { useHotkey } from '@/renderer/hooks/use-hotkey';
import { cn } from '@/renderer/lib/utils';
import {
	harnessIconClassName,
	harnessIconName,
} from '@/renderer/lib/workbench';
import { useMenuCommand } from '@/renderer/state/menu-commands';
import { tuiHarnessesAtom } from '@/renderer/state/preferences';
import { formatShortcut } from '@/shared/keymap';

import { GhostIconButton } from '../ghost-icon-button';
import { ShortcutTooltipContent } from '../shortcut-tooltip-content';

/** Display label for the coding-agent launcher shortcut, e.g. `⌘⇧A`. */
const AGENTS_SHORTCUT_HINT = formatShortcut('agents.open');

/** What the tab strip needs to hand a launch back to the workspace. */
interface HarnessLauncherProps {
	onLaunchHarness: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabChange: (sessionId: string) => void;
}

/**
 * Tab-strip launcher for the third-party CLI harnesses. Renders nothing while
 * the Experimental setting is off, and the gate is a wrapper rather than an
 * early return inside the dropdown so the PATH probe, the `⌘⇧A` binding, and the
 * native menu item's registration never happen at all — a disabled item in the
 * menu bar is exactly what "absent rather than disabled" rules out.
 */
export function HarnessLauncherMenu(props: HarnessLauncherProps) {
	const enabled = useAtomValue(tuiHarnessesAtom);
	if (!enabled) {
		return null;
	}
	return <HarnessLauncherDropdown {...props} />;
}

/**
 * Robot-icon dropdown listing the installed AI coding-agent harnesses. Selecting
 * one (by click or its number key) launches it in a new embedded-terminal tab
 * and focuses that tab. Availability is detected in the main process; only
 * installed harnesses are shown. The list is fetched lazily on first open.
 */
function HarnessLauncherDropdown({
	onLaunchHarness,
	onSessionTabChange,
}: HarnessLauncherProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [launchingId, setLaunchingId] = useState<string | null>(null);
	const launchedRef = useRef(false);
	const { data, isPending } = useQuery({
		queryFn: async () =>
			(await window.ensemblr?.listAgentHarnesses()) ?? { harnesses: [] },
		queryKey: ['agent-harnesses'],
		staleTime: 30_000,
	});
	const installedHarnesses = (data?.harnesses ?? []).filter(
		(harness) => harness.available,
	);
	const noHarnessesDetected = !isPending && installedHarnesses.length === 0;

	useHotkey('agents.open', () => setOpen(true), {
		enabled: !noHarnessesDetected,
	});
	useMenuCommand('agents.open', () => setOpen(true), !noHarnessesDetected);

	/** Launches the chosen harness, focuses the new tab, then closes the menu. */
	function handleLaunch(harnessId: string, harnessLabel: string) {
		if (launchingId) {
			return;
		}
		setLaunchingId(harnessId);
		void onLaunchHarness({ harnessId, harnessLabel })
			.then((result) => {
				if (result) {
					launchedRef.current = true;
					onSessionTabChange(result.chatTabId);
				}
			})
			.finally(() => {
				setLaunchingId(null);
				setOpen(false);
			});
	}

	/** Launches the harness whose 1-based position matches the pressed number. */
	function handleNumberShortcut(event: KeyboardEvent) {
		if (launchingId) {
			return;
		}
		const position = Number.parseInt(event.key, 10);
		if (
			Number.isNaN(position) ||
			position < 1 ||
			position > installedHarnesses.length
		) {
			return;
		}
		event.preventDefault();
		const harness = installedHarnesses[position - 1];
		handleLaunch(harness.id, harness.label);
	}

	if (noHarnessesDetected) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className='inline-flex'>
						<GhostIconButton
							disabled
							icon={<BotIcon />}
							label={t(
								'workbench:harness-launcher.trigger',
								'Launch coding agent',
							)}
						/>
					</span>
				</TooltipTrigger>
				<ShortcutTooltipContent
					label={t(
						'workbench:harness-launcher.none-detected',
						'No harnesses detected',
					)}
				/>
			</Tooltip>
		);
	}

	return (
		<DropdownMenu
			onOpenChange={(next) => {
				// Reset the launch marker on every open so a launch that resolves
				// after an early close (Escape while pending) can't leave a stale
				// true that suppresses focus restore on the next plain close.
				if (next) {
					launchedRef.current = false;
				}
				setOpen(next);
			}}
			open={open}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<GhostIconButton
							icon={<BotIcon />}
							label={t(
								'workbench:harness-launcher.trigger',
								'Launch coding agent',
							)}
						/>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<ShortcutTooltipContent
					label={t('workbench:harness-launcher.trigger', 'Launch coding agent')}
					shortcut={AGENTS_SHORTCUT_HINT}
				/>
			</Tooltip>
			<DropdownMenuContent
				align='end'
				className='w-56 p-1'
				onCloseAutoFocus={(event) => {
					// A launch activates the new terminal tab, which mounts XtermTerminal
					// and grabs keyboard focus. Radix otherwise restores focus to the
					// trigger on close, stealing it back; skip the restore only for a
					// launch so plain closes (Escape, click-outside) keep normal a11y.
					if (launchedRef.current) {
						launchedRef.current = false;
						event.preventDefault();
					}
				}}
				onKeyDown={handleNumberShortcut}
			>
				{installedHarnesses.length ? (
					installedHarnesses.map((harness, index) => {
						const iconName = harnessIconName(harness.id);
						return (
							<DropdownMenuItem
								className='h-9 gap-2 px-2 text-[0.8125rem]'
								disabled={launchingId !== null}
								key={harness.id}
								onSelect={(event) => {
									event.preventDefault();
									handleLaunch(harness.id, harness.label);
								}}
							>
								{iconName ? (
									<Icon
										aria-hidden='true'
										className={cn(
											'size-4 shrink-0',
											harnessIconClassName(harness.id),
										)}
										icon={iconName}
									/>
								) : (
									<BotIcon
										aria-hidden='true'
										className='size-4 shrink-0 text-muted-foreground'
									/>
								)}
								<span className='min-w-0 flex-1 truncate font-medium'>
									{harness.label}
								</span>
								{launchingId === harness.id ? (
									<LoaderCircleIcon
										aria-hidden='true'
										className='size-3.5 shrink-0 animate-spin'
									/>
								) : index < 9 ? (
									<kbd className='grid size-4 shrink-0 place-items-center rounded-sm border border-border font-medium text-[0.625rem] text-muted-foreground'>
										{index + 1}
									</kbd>
								) : null}
							</DropdownMenuItem>
						);
					})
				) : (
					<DropdownMenuItem
						className='h-9 px-2 text-muted-foreground text-xs'
						disabled
					>
						{t(
							'workbench:harness-launcher.none-installed',
							'No coding agents detected',
						)}
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
