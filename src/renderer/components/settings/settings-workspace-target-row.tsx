import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * The "which live workspace does this screen write to" picker every settings
 * surface that edits committed repository config now has to show, since ADR
 * 0070 stopped those writes reaching the root clone. The label and description
 * differ per screen; everything else — and the empty case — must not, so the
 * two screens cannot drift apart.
 */
export function SettingsWorkspaceTargetRow({
	description,
	label,
	onChange,
	value,
	workspaces,
}: {
	/** Screen-specific explanation of what the chosen workspace receives. */
	description: string;
	/** Screen-specific row label. */
	label: string;
	onChange: (workspaceId: string) => void;
	/** Currently picked workspace, or undefined before one resolves. */
	value: string | undefined;
	workspaces: WorkspaceShellModel[];
}) {
	const { t } = useTranslation();

	return (
		<SettingRow
			control={
				<Select onValueChange={onChange} value={value ?? ''}>
					<SelectTrigger className='w-56' size='sm'>
						<SelectValue
							placeholder={t(
								'settings:repo.workspace-target.placeholder',
								'Choose a workspace',
							)}
						/>
					</SelectTrigger>
					<SelectContent>
						{workspaces.map((workspace) => (
							<SelectItem key={workspace.id} value={workspace.id}>
								{workspace.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
			description={description}
			label={label}
		/>
	);
}
