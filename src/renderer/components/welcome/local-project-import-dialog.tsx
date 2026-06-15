import { useEffect, useState } from 'react';

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Spinner } from '@/renderer/components/ui/spinner';

const STILL_WORKING_DELAY_MS = 10_000;
const INITIAL_DESCRIPTION =
	'Ensemble is cloning the tracked git files into your managed repos folder, then creating the first workspace.';
const STILL_WORKING_DESCRIPTION =
	'Still working — large repositories with deep history can take a minute or two. The window will switch as soon as the workspace is ready.';

function ImportDialogBody() {
	const [stillWorking, setStillWorking] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => {
			setStillWorking(true);
		}, STILL_WORKING_DELAY_MS);

		return () => clearTimeout(timer);
	}, []);

	return (
		<div className='flex items-start gap-3'>
			<Spinner className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
			<DialogHeader className='gap-2'>
				<DialogTitle>Opening local project…</DialogTitle>
				<DialogDescription>
					{stillWorking ? STILL_WORKING_DESCRIPTION : INITIAL_DESCRIPTION}
				</DialogDescription>
			</DialogHeader>
		</div>
	);
}

/** Modal progress indicator shown while Ensemble imports a local project. */
export function LocalProjectImportDialog({ open }: { open: boolean }) {
	return (
		<Dialog open={open}>
			<DialogContent className='sm:max-w-md' showCloseButton={false}>
				{open ? <ImportDialogBody /> : null}
			</DialogContent>
		</Dialog>
	);
}
