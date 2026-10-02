import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Spinner } from '@/renderer/components/ui/spinner';

const STILL_WORKING_DELAY_MS = 10_000;

/** Dialog body that reports local-project opening progress after a delay. */
function LocalProjectOpenDialogBody() {
	const { t } = useTranslation();
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
				<DialogTitle>
					{t('common:local-project-open.title', 'Opening local project…')}
				</DialogTitle>
				<DialogDescription>
					{stillWorking
						? t(
								'common:local-project-open.still-working',
								'Still working — creating the first workspace can take a minute or two. The window will switch as soon as it is ready.',
							)
						: t(
								'common:local-project-open.description',
								'Ensemblr is registering this folder as your project root, then creating the first workspace.',
							)}
				</DialogDescription>
			</DialogHeader>
		</div>
	);
}

/** Modal progress indicator shown while Ensemblr opens a local project. */
export function LocalProjectOpenDialog({ open }: { open: boolean }) {
	return (
		<Dialog open={open}>
			<DialogContent className='sm:max-w-md' showCloseButton={false}>
				{open ? <LocalProjectOpenDialogBody /> : null}
			</DialogContent>
		</Dialog>
	);
}
