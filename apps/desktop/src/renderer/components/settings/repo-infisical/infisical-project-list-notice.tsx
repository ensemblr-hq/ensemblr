import { useTranslation } from 'react-i18next';

import type { InfisicalProjectsResult } from '@/shared/ipc/contracts/infisical';

import { InfisicalFailureText } from './infisical-failure-text';

/** Props for the notices that explain an empty or partial project list. */
interface InfisicalProjectListNoticeProps {
	loading: boolean;
	result: InfisicalProjectsResult | null;
	/** Project the saved link names that no configured account can reach. */
	unreachableProjectId: string | null;
}

/**
 * Explains why the project picker is empty, short, or missing the project this
 * repository already points at. An empty list is ambiguous on its own — the
 * call may have failed, or the Machine Identity may simply not have been added
 * to any project yet, which is a required step in Infisical that is easy to
 * miss — so it never renders as a silently empty dropdown.
 */
export function InfisicalProjectListNotice({
	loading,
	result,
	unreachableProjectId,
}: InfisicalProjectListNoticeProps) {
	const { t } = useTranslation();

	if (loading || !result) {
		return null;
	}

	if (result.failure) {
		return <InfisicalFailureText className='mb-4' failure={result.failure} />;
	}

	if (result.projects.length === 0) {
		return (
			<p className='pb-4 text-muted-foreground text-xs leading-relaxed'>
				{t(
					'settings:repo.infisical.projects-empty',
					'Infisical answered, but none of your accounts can see a project. A Machine Identity only sees a project once it has been added to it — open the project in Infisical, then Project Settings → Access Control → Machine Identities → Add identity, and re-open this page.',
				)}
			</p>
		);
	}

	if (!unreachableProjectId && result.accountFailures.length === 0) {
		return null;
	}

	return (
		<div className='space-y-2 pb-4'>
			{unreachableProjectId ? (
				<p className='text-muted-foreground text-xs leading-relaxed'>
					{t(
						'settings:repo.infisical.unreachable-project',
						'This repository points at project {{projectId}}, which none of your accounts can see. Add your Machine Identity to it in Infisical, or pick a different project.',
						{ projectId: unreachableProjectId },
					)}
				</p>
			) : null}
			{result.accountFailures.map((accountFailure) => (
				<p
					className='text-muted-foreground text-xs leading-relaxed'
					key={accountFailure.accountId}
				>
					{t(
						'settings:repo.infisical.account-unavailable',
						'Projects from {{account}} are missing from this list: that account could not be reached.',
						{ account: accountFailure.accountLabel },
					)}
				</p>
			))}
		</div>
	);
}
