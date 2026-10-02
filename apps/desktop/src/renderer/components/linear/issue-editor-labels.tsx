import { CheckIcon, TagIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';
import type { LinearResourceWire } from '@/shared/ipc/contracts/linear';

/** A label's own Linear color as a small dot, so the list scans by hue. */
function LabelDot({ color }: { color: string | null }) {
	return (
		<span
			aria-hidden='true'
			className='size-2 shrink-0 rounded-full'
			style={{ backgroundColor: color ?? 'var(--muted-foreground)' }}
		/>
	);
}

/**
 * Label picker: one pill that opens a searchable list, plus a chip per chosen
 * label. The flat chip wall it replaces printed every label of every team at
 * once, so two teams that both have a `Bug` label rendered it twice with
 * nothing to tell the pair apart.
 */
export function IssueEditorLabelPicker({
	disabled,
	labels,
	onChange,
	selectedIds,
}: {
	disabled?: boolean;
	labels: LinearResourceWire[];
	onChange: (labelIds: string[]) => void;
	selectedIds: string[];
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const selected = new Set(selectedIds);
	const chosen = labels.filter((label) => selected.has(label.id));
	const title = t('linear:issue-editor.field.labels', 'Labels');

	if (labels.length === 0) {
		return null;
	}

	return (
		<>
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger asChild>
					<Button
						aria-label={title}
						className={cn(
							'font-normal',
							chosen.length ? null : 'text-muted-foreground',
						)}
						disabled={disabled}
						size='sm'
						variant='outline'
					>
						<TagIcon data-icon='inline-start' />
						{title}
						{chosen.length > 0 ? (
							<span className='tabular-nums'>{chosen.length}</span>
						) : null}
					</Button>
				</PopoverTrigger>
				<PopoverContent align='start' className='w-64 p-0'>
					<Command>
						<CommandInput
							placeholder={t(
								'linear:issue-editor.labels-search',
								'Find a label…',
							)}
						/>
						<CommandList>
							<CommandEmpty>
								{t('linear:issue-editor.labels-empty', 'No matching label.')}
							</CommandEmpty>
							{labels.map((label) => (
								<CommandItem
									key={label.id}
									keywords={[label.name]}
									onSelect={() =>
										onChange(
											selected.has(label.id)
												? selectedIds.filter((id) => id !== label.id)
												: [...selectedIds, label.id],
										)
									}
									value={label.id}
								>
									<LabelDot color={label.color} />
									<span className='flex-1 truncate'>{label.name}</span>
									{selected.has(label.id) ? (
										<CheckIcon className='size-3.5 shrink-0' />
									) : null}
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			{chosen.map((label) => (
				<button
					className='inline-flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),0.75rem)] border border-border bg-muted/40 pr-2 pl-2.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
					key={label.id}
					onClick={() => onChange(selectedIds.filter((id) => id !== label.id))}
					title={t('linear:issue-editor.labels-remove', 'Remove label')}
					type='button'
				>
					<LabelDot color={label.color} />
					<span className='max-w-32 truncate'>{label.name}</span>
				</button>
			))}
		</>
	);
}
