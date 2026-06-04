import { GitBranchIcon, SquareTerminalIcon } from 'lucide-react';
import { ShellPanel } from '@/components/shell-panel';
import { StatusBadge } from '@/components/status-badge';
import { Progress } from '@/components/ui/progress';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const terminalLines = [
	'$ pi session create --workspace tashkent',
	'workspace: /workspaces/piductor/tashkent',
	'agent: design-system-foundation',
	'ipc: health bridge reachable',
	'ui: renderer tokens compiled',
	'next: bind real Pi turns and terminal stream',
];

const diffRows = [
	{ label: '+ src/components/app-frame.tsx', tone: 'add' },
	{ label: '+ src/components/design-system-preview.tsx', tone: 'add' },
	{ label: '+ src/components/terminal-dock.tsx', tone: 'add' },
	{ label: '~ src/renderer/App.tsx', tone: 'edit' },
	{ label: '~ src/renderer/styles.css', tone: 'edit' },
] as const;

export function TerminalDock() {
	return (
		<ShellPanel
			action={<StatusBadge tone='info'>Run</StatusBadge>}
			description='Setup, run, and terminal output will share this lower dock region.'
			eyebrow='Dock'
			title='Run output'
		>
			<div className='overflow-hidden rounded-md border border-terminal-border bg-terminal text-terminal-foreground shadow-terminal'>
				<div className='flex h-8 items-center justify-between border-terminal-border border-b px-3'>
					<div className='flex items-center gap-2 font-medium text-xs'>
						<SquareTerminalIcon
							aria-hidden='true'
							className='size-4 shrink-0'
						/>
						<span>piductor-agent</span>
					</div>
					<StatusBadge
						className='bg-terminal-muted/30 text-terminal-foreground'
						tone='muted'
					>
						Simulated
					</StatusBadge>
				</div>
				<ResizablePanelGroup
					className='h-[13.75rem] min-h-[13.75rem]'
					orientation='horizontal'
				>
					<ResizablePanel defaultSize={62} minSize={44}>
						<ScrollArea className='terminal-scanline h-full'>
							<div className='flex flex-col gap-1.5 p-3 font-mono text-xs leading-5'>
								{terminalLines.map((line, index) => (
									<div className='flex gap-3' key={line}>
										<span className='select-none text-terminal-muted'>
											{String(index + 1).padStart(2, '0')}
										</span>
										<code>{line}</code>
									</div>
								))}
							</div>
						</ScrollArea>
					</ResizablePanel>
					<ResizableHandle className='bg-terminal-border/80' withHandle />
					<ResizablePanel defaultSize={38} minSize={26}>
						<div className='flex h-full flex-col'>
							<div className='flex h-8 items-center gap-2 border-terminal-border border-b px-3 text-xs'>
								<GitBranchIcon
									aria-hidden='true'
									className='size-3.5 shrink-0'
								/>
								<span>review delta</span>
							</div>
							<div className='flex flex-1 flex-col gap-1.5 p-3 font-mono text-[0.6875rem]'>
								{diffRows.map((row) => (
									<div
										className={
											row.tone === 'add'
												? 'rounded bg-diff-addition px-2 py-1 text-diff-addition-foreground'
												: 'rounded bg-diff-modified px-2 py-1 text-diff-modified-foreground'
										}
										key={row.label}
									>
										{row.label}
									</div>
								))}
							</div>
							<Separator className='bg-terminal-border' />
							<div className='flex flex-col gap-1.5 p-3'>
								<div className='flex justify-between text-[0.6875rem] text-terminal-muted'>
									<span>foundation coverage</span>
									<span>72%</span>
								</div>
								<Progress className='bg-terminal-muted/30' value={72} />
							</div>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</ShellPanel>
	);
}
