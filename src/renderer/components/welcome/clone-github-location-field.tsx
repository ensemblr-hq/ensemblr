import type { KeyboardEventHandler } from 'react';

import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';

/** Destination controls for the clone dialog: the path field, Browse, and Reset. */
interface CloneGithubLocationFieldProps {
	browseDisabled: boolean;
	canReset: boolean;
	disabled: boolean;
	onBrowse: () => void;
	onChange: (value: string) => void;
	onReset: () => void;
	onSubmitKey: KeyboardEventHandler<HTMLInputElement>;
	placeholder: string;
	value: string;
}

/**
 * Where the repository will be cloned: an editable path, a native directory
 * picker, and a reset back to the managed repos directory once the user has
 * moved away from it.
 */
export function CloneGithubLocationField({
	browseDisabled,
	canReset,
	disabled,
	onBrowse,
	onChange,
	onReset,
	onSubmitKey,
	placeholder,
	value,
}: CloneGithubLocationFieldProps) {
	return (
		<div className='flex flex-col gap-1.5'>
			<Label className='text-xs' htmlFor='clone-github-location'>
				Location
			</Label>
			<div className='flex gap-2'>
				<Input
					className='h-9 flex-1 font-mono text-xs'
					disabled={disabled}
					id='clone-github-location'
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={onSubmitKey}
					placeholder={placeholder}
					value={value}
				/>
				<Button
					className='h-9'
					disabled={browseDisabled}
					onClick={onBrowse}
					type='button'
					variant='outline'
				>
					Browse
				</Button>
			</div>
			{canReset ? (
				<button
					className='self-start text-muted-foreground text-xxs underline-offset-2 hover:underline'
					onClick={onReset}
					type='button'
				>
					Reset to managed repos directory
				</button>
			) : null}
		</div>
	);
}
