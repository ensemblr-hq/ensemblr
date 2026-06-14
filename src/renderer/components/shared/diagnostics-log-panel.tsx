import { CheckIcon, ClipboardIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import { cn } from '@/renderer/lib/utils';

interface DiagnosticsLogPanelProps {
	label: string;
	lines: readonly string[];
	defaultOpen?: boolean;
	className?: string;
}

/**
 * Collapsible log surface for diagnostics output. Sanitization is the caller's
 * responsibility (mask secrets before passing in). Renders a monospace block
 * with copy-to-clipboard and a line counter.
 */
export function DiagnosticsLogPanel({
	className,
	defaultOpen = false,
	label,
	lines,
}: DiagnosticsLogPanelProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		const text = lines.join('\n');
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	};

	return (
		<Collapsible
			className={cn('rounded-md border bg-card/40', className)}
			defaultOpen={defaultOpen}
		>
			<div className='flex items-center justify-between gap-2 px-3 py-2'>
				<CollapsibleTrigger asChild>
					<Button size='sm' variant='ghost'>
						{label}
						<span className='text-muted-foreground text-xs'>
							{lines.length} line{lines.length === 1 ? '' : 's'}
						</span>
					</Button>
				</CollapsibleTrigger>
				<Button
					aria-label='Copy log'
					onClick={handleCopy}
					size='sm'
					variant='ghost'
				>
					{copied ? (
						<CheckIcon aria-hidden='true' className='size-3' />
					) : (
						<ClipboardIcon aria-hidden='true' className='size-3' />
					)}
					{copied ? 'Copied' : 'Copy'}
				</Button>
			</div>
			<CollapsibleContent>
				<pre className='max-h-64 overflow-auto border-t bg-code px-3 py-2 font-mono text-code-foreground text-xs leading-relaxed'>
					{lines.length === 0 ? (
						<span className='text-muted-foreground'>
							No log output captured.
						</span>
					) : (
						lines.join('\n')
					)}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}
