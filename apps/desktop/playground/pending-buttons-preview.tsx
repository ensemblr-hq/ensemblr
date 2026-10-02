import { ArchiveIcon, GitMergeIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { DialogActionFooter } from '@/renderer/components/dialog-action-footer';
import { Button } from '@/renderer/components/ui/button';
import { LifecycleDialogActions } from '@/renderer/components/workbench-shell/lifecycle-dialog-actions';

import {
	ControlGroup,
	SceneControls,
	SceneOnOff,
	SceneSection,
} from './scene-chrome.tsx';

/** The button variants a confirm or lifecycle action is ever drawn in. */
const VARIANTS = ['default', 'destructive', 'outline', 'ghost'] as const;

/** The sizes those actions ship at, smallest first, to check spinner scaling. */
const SIZES = ['xs', 'sm', 'default', 'lg'] as const;

/**
 * Every pending button state on one canvas. The point of the scene is the
 * before/after: flipping `pending` must swap a leading icon for the spinner and
 * leave the label — and therefore the button's width — exactly where it was, so
 * a confirm button does not jump under the cursor that just pressed it.
 */
export function PendingButtonsScene() {
	const [pending, setPending] = useState(true);

	return (
		<div className='flex flex-col gap-10'>
			<SceneControls>
				<ControlGroup label='pending'>
					<SceneOnOff isOn={pending} onChange={setPending} />
				</ControlGroup>
			</SceneControls>

			<SceneSection
				label='Button · pending across variants'
				note='Label-only actions. The spinner arrives as an inline-start icon, so the button gains the same leading padding an icon would have given it.'
			>
				<div className='flex flex-col gap-3'>
					{VARIANTS.map((variant) => (
						<div className='flex items-center gap-3' key={variant}>
							<span className='w-24 shrink-0 font-mono text-muted-foreground text-xxs'>
								{variant}
							</span>
							<Button pending={pending} variant={variant}>
								Delete
							</Button>
							<Button pending={false} variant={variant}>
								Delete
							</Button>
							<span className='font-mono text-muted-foreground text-xxs'>
								pending · idle
							</span>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='Button · pending across sizes'
				note='The spinner carries no size class of its own, so each size scales it the way it scales a lucide icon: 0.75rem at xs, 0.875rem at sm, 1rem above.'
			>
				<div className='flex flex-col gap-3'>
					{SIZES.map((size) => (
						<div className='flex items-center gap-3' key={size}>
							<span className='w-24 shrink-0 font-mono text-muted-foreground text-xxs'>
								{size}
							</span>
							<Button pending={pending} size={size}>
								Save
							</Button>
							<Button pending={pending} size={size}>
								<ArchiveIcon aria-hidden='true' data-icon='inline-start' />
								Archive
							</Button>
							<Button pending={false} size={size}>
								<ArchiveIcon aria-hidden='true' data-icon='inline-start' />
								Archive
							</Button>
							<span className='font-mono text-muted-foreground text-xxs'>
								label · icon pending · icon idle
							</span>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='Icon-only actions'
				note='An icon-only button has nothing to fall back to, so the spinner takes the icon’s place rather than sitting beside it.'
			>
				<div className='flex items-center gap-3'>
					<Button
						aria-label='Delete · pending'
						pending={pending}
						size='icon'
						variant='destructive'
					>
						<Trash2Icon aria-hidden='true' />
					</Button>
					<Button
						aria-label='Delete · idle'
						pending={false}
						size='icon'
						variant='destructive'
					>
						<Trash2Icon aria-hidden='true' />
					</Button>
					<Button
						aria-label='Merge · pending'
						pending={pending}
						size='icon-sm'
						variant='outline'
					>
						<GitMergeIcon aria-hidden='true' />
					</Button>
					<Button
						aria-label='Merge · idle'
						pending={false}
						size='icon-sm'
						variant='outline'
					>
						<GitMergeIcon aria-hidden='true' />
					</Button>
				</div>
			</SceneSection>

			<SceneSection
				label='Lifecycle dialog footer'
				note='The shipped footer the four archive and delete dialogs share. Dismiss reads “Close” while the run is in flight, and the confirm button keeps its verb.'
			>
				<div className='flex max-w-md flex-col gap-2 rounded-xl border border-border p-4'>
					<LifecycleDialogActions
						actionLabel='Delete'
						actionVariant='destructive'
						canAct={!pending}
						diagnostics={[]}
						diagnosticsTestId='playground-lifecycle-diagnostics'
						isBusy={pending}
						onAct={() => undefined}
						onClose={() => undefined}
					/>
				</div>
			</SceneSection>

			<SceneSection
				label='Create and rename dialog footer'
				note='The sticky footer behind quick start and rename. The ⌘↵ hint is not an icon, so it survives the pending state alongside the spinner.'
			>
				<div className='flex max-w-md flex-col gap-2 rounded-xl border border-border p-4'>
					<DialogActionFooter
						onRetry={null}
						onSubmit={() => undefined}
						submitDisabled={false}
						submitLabel='Create'
						submitPending={pending}
					/>
				</div>
			</SceneSection>
		</div>
	);
}
