import { NetworkIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';

import { GhostIconButton } from './ghost-icon-button';

/**
 * Tab-strip control that opens the workspace's architecture diagram and
 * focuses it.
 *
 * Lives beside `session-tabs.tsx` rather than inside it because that file is
 * already close to the repository's 800-line ceiling.
 */
export function ArchitectureDiagramButton({
	onOpenArchitectureDiagram,
	onSessionTabChange,
}: {
	onOpenArchitectureDiagram: () => Promise<{ chatTabId: string } | null>;
	onSessionTabChange: (sessionId: string) => void;
}) {
	const { t } = useTranslation();
	const [isOpening, setIsOpening] = useState(false);
	const label = t(
		'workbench:architecture-diagram.open',
		'Workspace architecture',
	);

	/** Opens the diagram tab and selects it, guarding against a double click. */
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
			.finally(() => setIsOpening(false));
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
