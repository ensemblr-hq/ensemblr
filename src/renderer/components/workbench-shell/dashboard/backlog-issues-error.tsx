import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelAlert } from '@/renderer/components/workbench-shell/panel-alert';
import { groupBoardIssueFailures } from '@/renderer/lib/workbench/board-issue-failures';
import { describeCommandFailure } from '@/renderer/lib/workbench/git-failure-copy';
import type { BoardIssuesFailure } from '@/renderer/types/workbench-shell';

/**
 * Says why Backlog is short. A repository whose `gh issue list` failed
 * contributes nothing, so the column would otherwise read as "nothing to do" —
 * each banner is headlined by what went wrong, names the repositories it cost,
 * and demotes `gh`'s own words underneath, which for the unclassified failures
 * is the only account of the cause there is.
 */
export function BacklogIssuesError({
	failures,
}: {
	failures: readonly BoardIssuesFailure[];
}) {
	const { t } = useTranslation();
	const groups = useMemo(() => groupBoardIssueFailures(failures), [failures]);
	if (groups.length === 0) {
		return null;
	}

	return (
		<div className='flex flex-col gap-2 px-2 pb-2'>
			{groups.map((group) => {
				const { detail, message } = describeCommandFailure(group.failure);
				return (
					<PanelAlert
						detail={detail}
						key={`${group.failure.code}:${group.projectNames.join(',')}`}
						message={t(
							'workbench:dashboard.column.issues-error.missing-from',
							'Backlog is missing issues from {{repositories}}.',
							{ repositories: group.projectNames.join(', ') },
						)}
						title={message}
					/>
				);
			})}
		</div>
	);
}
