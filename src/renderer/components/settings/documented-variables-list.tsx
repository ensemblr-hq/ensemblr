import { LockIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import type { EnvironmentVariableSnapshot } from '@/shared/ipc/contracts/environment';

interface DocumentedVariablesListProps {
	variables: EnvironmentVariableSnapshot[];
	onAdd: (key: string) => void;
}

/** Collapsible list of settable, currently-unset catalog variables. */
export function DocumentedVariablesList({
	onAdd,
	variables,
}: DocumentedVariablesListProps) {
	const [open, setOpen] = useState(false);

	if (variables.length === 0) {
		return null;
	}

	return (
		<Collapsible onOpenChange={setOpen} open={open}>
			<CollapsibleTrigger asChild>
				<Button className='px-0 text-muted-foreground' size='sm' variant='link'>
					{open
						? 'Hide documented variables'
						: `Show documented variables (${variables.length})`}
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className='mt-2 divide-y divide-border rounded-md border bg-card/40'>
					{variables.map((variable) => (
						<li
							className='flex items-center gap-3 px-3 py-2.5 text-sm'
							key={variable.key}
						>
							<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
								<div className='flex items-center gap-2'>
									{variable.valueKind === 'secret' ? (
										<LockIcon
											aria-hidden='true'
											className='size-3.5 shrink-0 text-muted-foreground'
										/>
									) : null}
									<code className='font-mono text-foreground text-xs'>
										{variable.key}
									</code>
								</div>
								<p className='truncate text-muted-foreground text-xs'>
									{variable.catalog.description}
								</p>
							</div>
							<Badge className='shrink-0' variant='outline'>
								Not set
							</Badge>
							<Button
								aria-label={`Add ${variable.key}`}
								className='shrink-0'
								onClick={() => onAdd(variable.key)}
								size='icon-xs'
								variant='ghost'
							>
								<PlusIcon aria-hidden='true' className='size-3.5' />
							</Button>
						</li>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}
