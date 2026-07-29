import { MessageSquareIcon, SquareTerminalIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { TabScroller } from '@/renderer/components/ui/tab-scroller';
import { cn } from '@/renderer/lib/utils';
import {
	SESSION_TAB_CLOSE_FADE_CLASS,
	sessionTabIndicatorVariants,
	sessionTabVariants,
} from '@/renderer/lib/workbench/session-tabs-variants';

const TABS = [
	'Refactor session tabs',
	'Fix xterm resize',
	'claude',
	'Review PR 188',
	'codex',
	'Dock panel polish',
	'Timeline descriptors',
	'amp',
	'Keymap regressions',
	'Playground scenes',
	'Release notes',
	'Settings rewrite',
].map((label, index) => ({
	id: `tab-${index}`,
	isTerminal: label === label.toLowerCase(),
	label,
}));

/**
 * Drives {@link TabScroller} with a session-tab-shaped strip that always
 * overflows, so the auto-hiding scrollbar and the activate-scrolls-into-view
 * behaviour can be eyeballed without the Electron runtime.
 */
export function TabScrollerScene() {
	const [activeId, setActiveId] = useState(TABS[0].id);

	return (
		<div className='flex flex-col gap-6'>
			<p className='text-muted-foreground text-xs'>
				Activate a tab with the buttons below the strip: the strip scrolls it
				fully into view. Hover or scroll the strip to reveal the overlay
				scrollbar; it fades out once the pointer leaves.
			</p>
			<div className='flex h-10 items-center gap-1.5 border-border border-b bg-background'>
				<TabScroller activeKey={activeId} className='h-full'>
					<div className='flex h-full w-max min-w-full'>
						{TABS.map((tab) => (
							<div
								className={sessionTabVariants({
									isActive: tab.id === activeId,
								})}
								data-tab-key={tab.id}
								key={tab.id}
							>
								<button
									className='flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left'
									onClick={() => setActiveId(tab.id)}
									type='button'
								>
									{tab.isTerminal ? (
										<SquareTerminalIcon className='size-3.5 shrink-0' />
									) : (
										<MessageSquareIcon className='size-3.5 shrink-0' />
									)}
									<span className='truncate'>{tab.label}</span>
								</button>
								<span
									aria-hidden='true'
									className={SESSION_TAB_CLOSE_FADE_CLASS}
								/>
								<span className='absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-sm opacity-0 group-hover/session-tab:opacity-100'>
									<XIcon className='size-3' />
								</span>
								<span
									aria-hidden='true'
									className={sessionTabIndicatorVariants({
										edge: 'bottom',
										tone: tab.id === activeId ? 'active' : 'none',
									})}
								/>
							</div>
						))}
					</div>
				</TabScroller>
			</div>
			<div className='flex flex-wrap gap-1'>
				{TABS.map((tab) => (
					<button
						className={cn(
							'rounded-md border px-2 py-1 font-mono text-xxs transition-colors',
							tab.id === activeId
								? 'border-border bg-surface text-foreground'
								: 'border-transparent text-muted-foreground hover:bg-accent/50',
						)}
						key={tab.id}
						onClick={() => setActiveId(tab.id)}
						type='button'
					>
						{tab.label}
					</button>
				))}
			</div>
		</div>
	);
}
