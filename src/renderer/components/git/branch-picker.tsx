import { ChevronsUpDownIcon, GitBranchIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { useBranchOptions } from '@/renderer/hooks/git/use-branch-options';
import { cn } from '@/renderer/lib/utils';
import { bareBranchName } from '@/shared/branch-ref';
import type { RepositoryBranchWire } from '@/shared/ipc/contracts/workspace-sources';

/** Props for {@link BranchPicker}. */
interface BranchPickerProps {
	align?: 'center' | 'end' | 'start';
	className?: string;
	disabled?: boolean;
	/**
	 * Entry pinned above the branch list, used where clearing back to an
	 * inherited value is meaningful. Omit to offer branches only. `isActive`
	 * drives the check mark, because an inherited value still reads as a
	 * selected branch and cannot be told apart from a pinned one.
	 */
	fallbackOption?: { isActive: boolean; label: string; onSelect: () => void };
	/** Called with the bare branch name; the caller qualifies it with a remote. */
	onSelect: (branchName: string) => void;
	/**
	 * Called with typed text verbatim when it names no listed branch. Required to
	 * reach refs GitHub does not list — another remote, a tag, a repository `gh`
	 * cannot read. Unlike {@link BranchPickerProps.onSelect} the value is already
	 * a full ref, so the caller must not qualify it further.
	 */
	onSelectCustomRef?: (ref: string) => void;
	placeholder: string;
	repositoryId: string;
	searchPlaceholder: string;
	/** Current branch ref, remote-qualified or bare. */
	value: string | null | undefined;
}

/**
 * Searchable picker over a repository's remote branches, shared by the
 * workspace target-branch control and the repo-level branch-from setting.
 * Branches load only while the popover is open.
 */
export function BranchPicker({
	align = 'start',
	className,
	disabled,
	fallbackOption,
	onSelect,
	onSelectCustomRef,
	placeholder,
	repositoryId,
	searchPlaceholder,
	value,
}: BranchPickerProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const { branches, error, isLoading } = useBranchOptions(repositoryId, open);
	const selected = bareBranchName(value);

	const close = () => {
		setOpen(false);
		setSearch('');
	};

	const typedRef = search.trim();
	const offersTypedRef =
		onSelectCustomRef !== undefined &&
		typedRef.length > 0 &&
		!branches.some((branch) => branch.name === typedRef);

	return (
		<Popover
			onOpenChange={(next) => (next ? setOpen(true) : close())}
			open={open}
		>
			<PopoverTrigger asChild>
				<Button
					className={cn('h-7 gap-1.5 px-1.5 font-medium text-xs', className)}
					disabled={disabled}
					size='sm'
					variant='ghost'
				>
					<GitBranchIcon
						aria-hidden='true'
						className='size-3.5 shrink-0 text-muted-foreground'
					/>
					<span className='min-w-0 truncate'>{selected ?? placeholder}</span>
					<ChevronsUpDownIcon
						aria-hidden='true'
						className='size-3.5 shrink-0 text-muted-foreground'
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent align={align} className='w-72 overflow-hidden p-0'>
				<Command>
					<CommandInput
						onValueChange={setSearch}
						placeholder={searchPlaceholder}
						value={search}
					/>
					<CommandList>
						<BranchListStatus
							error={error?.message ?? null}
							isEmpty={branches.length === 0 && !offersTypedRef}
							isLoading={isLoading}
							remediation={error?.remediation ?? null}
						/>
						{fallbackOption ? (
							<PinnedOption
								isChecked={fallbackOption.isActive}
								label={
									<span className='text-muted-foreground'>
										{fallbackOption.label}
									</span>
								}
								onSelect={() => {
									fallbackOption.onSelect();
									close();
								}}
								value={fallbackOption.label}
							/>
						) : null}
						{offersTypedRef && onSelectCustomRef ? (
							<PinnedOption
								isChecked={typedRef === selected}
								label={
									<Trans
										components={{ ref: <span className='font-mono' /> }}
										defaults='Use <ref>{{typedRef}}</ref>'
										i18nKey='git:branch-picker.use-typed-ref'
										values={{ typedRef }}
									/>
								}
								onSelect={() => {
									onSelectCustomRef(typedRef);
									close();
								}}
								value={typedRef}
							/>
						) : null}
						<CommandGroup>
							{branches.map((branch) => (
								<BranchOption
									branch={branch}
									isChecked={branch.name === selected}
									key={branch.name}
									onSelect={() => {
										onSelect(branch.name);
										close();
									}}
								/>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * Entry sitting above the branch list in its own group, separated so a choice
 * that is not one of the repository's branches does not read as one.
 */
function PinnedOption({
	isChecked,
	label,
	onSelect,
	value,
}: {
	isChecked: boolean;
	label: ReactNode;
	onSelect: () => void;
	value: string;
}) {
	return (
		<>
			<CommandGroup>
				<CommandItem
					className='gap-2'
					data-checked={isChecked ? 'true' : undefined}
					keywords={[value]}
					onSelect={onSelect}
					value={value}
				>
					<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>
						{label}
					</span>
				</CommandItem>
			</CommandGroup>
			<CommandSeparator />
		</>
	);
}

/** One remote branch row, tagging the repository's default so it reads apart. */
function BranchOption({
	branch,
	isChecked,
	onSelect,
}: {
	branch: RepositoryBranchWire;
	isChecked: boolean;
	onSelect: () => void;
}) {
	const { t } = useTranslation();

	return (
		<CommandItem
			className='gap-2'
			data-checked={isChecked ? 'true' : undefined}
			keywords={[branch.name]}
			onSelect={onSelect}
			value={branch.name}
		>
			<span className='min-w-0 flex-1 truncate font-mono text-[0.8125rem]'>
				{branch.name}
			</span>
			{branch.isDefault ? (
				<span className='shrink-0 text-muted-foreground text-xxs'>
					{t('git:branch-picker.default-tag', 'default')}
				</span>
			) : null}
		</CommandItem>
	);
}

/**
 * Renders the non-list states of the branch popover. A `gh` failure and an
 * empty remote are indistinguishable from a bare empty list, so each gets its
 * own message.
 */
function BranchListStatus({
	error,
	isEmpty,
	isLoading,
	remediation,
}: {
	error: string | null;
	isEmpty: boolean;
	isLoading: boolean;
	remediation: string | null;
}) {
	const { t } = useTranslation();

	if (isLoading) {
		return (
			<div className='py-6 text-center text-muted-foreground text-xs'>
				{t('git:branch-picker.loading', 'Loading branches…')}
			</div>
		);
	}

	if (error) {
		return (
			<div className='space-y-1 px-3 py-4 text-xs'>
				<p className='text-destructive'>{error}</p>
				{remediation ? (
					<p className='text-muted-foreground'>{remediation}</p>
				) : null}
			</div>
		);
	}

	if (isEmpty) {
		return (
			<div className='py-6 text-center text-muted-foreground text-xs'>
				{t('git:branch-picker.empty-remote', 'No remote branches found.')}
			</div>
		);
	}

	return (
		<CommandEmpty className='py-6 text-muted-foreground text-xs'>
			{t('git:branch-picker.no-match', 'No branches match.')}
		</CommandEmpty>
	);
}
