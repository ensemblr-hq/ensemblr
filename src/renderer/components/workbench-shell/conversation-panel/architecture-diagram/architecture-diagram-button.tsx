import { useAtomValue } from 'jotai';
import { NetworkIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { architectureDiagramAtom } from '@/renderer/state/preferences';

import { GhostIconButton } from '../ghost-icon-button';

/**
 * Tab-strip control that opens the workspace's architecture diagram and
 * focuses it. Renders nothing while the Experimental architecture-diagram
 * setting is off, which is the tab strip's whole surface for the feature.
 */
export function ArchitectureDiagramButton({
	onOpenArchitectureDiagram,
	onSessionTabChange,
}: {
	onOpenArchitectureDiagram: () => Promise<{ chatTabId: string } | null>;
	onSessionTabChange: (sessionId: string) => void;
}) {
	const { t } = useTranslation();
	const enabled = useAtomValue(architectureDiagramAtom);
	const [isOpening, setIsOpening] = useState(false);
	const label = t(
		'workbench:architecture-diagram.open',
		'Workspace architecture',
	);

	/**
	 * Opens the diagram tab and selects it, guarding against a double click.
	 * The open is a database write behind `mutateAsync`, so a rejection has to be
	 * caught here — `.finally` re-enables the button and would otherwise leave a
	 * live-looking control over an unhandled rejection.
	 */
	function handleOpen() {
		if (isOpening) {
			return;
		}
		setIsOpening(true);
		void onOpenArchitectureDiagram()
			.then((result) => {
				if (result) {
					onSessionTabChange(result.chatTabId);
				}
			})
			.catch(() => {
				toast.error(
					t(
						'errors:architecture-diagram.open-failed.title',
						'Could not open the architecture diagram',
					),
					{
						description: t(
							'errors:architecture-diagram.open-failed.description',
							'The tab could not be opened. Try again.',
						),
					},
				);
			})
			.finally(() => setIsOpening(false));
	}

	if (!enabled) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<GhostIconButton
					disabled={isOpening}
					icon={<NetworkIcon />}
					label={label}
					onClick={handleOpen}
				/>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
