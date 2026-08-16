import { useTranslation } from 'react-i18next';

import { Input } from '@/renderer/components/ui/input';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import { cn } from '@/renderer/lib/utils';
import type {
	InfisicalEnvironmentSnapshot,
	InfisicalProjectSnapshot,
} from '@/shared/ipc/contracts/infisical';

import { infisicalProjectKey } from './infisical-link-form';

/** Width every control on this panel shares, so the fields line up in one column. */
const FIELD_WIDTH = 'w-full sm:w-72';

/**
 * Picks a project out of every account at once. Accounts only become visible
 * as group headings when more than one is configured — with a single account
 * the heading would repeat its own name down the list.
 */
export function InfisicalProjectSelect({
	loading,
	onChange,
	projects,
	value,
}: {
	loading: boolean;
	onChange: (projectKey: string) => void;
	projects: InfisicalProjectSnapshot[];
	value: string | null;
}) {
	const { t } = useTranslation();
	const groups = groupByAccount(projects);
	const showAccountHeadings = groups.length > 1;

	return (
		<Select
			disabled={loading || projects.length === 0}
			onValueChange={onChange}
			value={value ?? undefined}
		>
			<SelectTrigger className={FIELD_WIDTH}>
				<SelectValue
					placeholder={
						loading
							? t(
									'settings:repo.infisical.projects-loading',
									'Loading projects…',
								)
							: t(
									'settings:repo.infisical.project-placeholder',
									'Pick a project',
								)
					}
				/>
			</SelectTrigger>
			<SelectContent>
				{groups.map((group) => (
					<SelectGroup key={group.accountId}>
						{showAccountHeadings ? (
							<SelectLabel>{group.accountLabel}</SelectLabel>
						) : null}
						{group.projects.map((project) => (
							<SelectItem
								key={infisicalProjectKey(project)}
								value={infisicalProjectKey(project)}
							>
								{project.name}
							</SelectItem>
						))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * Environment picker fed by the environments the projects call already
 * returned, so choosing one costs no extra request.
 */
export function InfisicalEnvironmentSelect({
	environments,
	onChange,
	value,
}: {
	environments: InfisicalEnvironmentSnapshot[];
	onChange: (slug: string) => void;
	value: string | null;
}) {
	const { t } = useTranslation();

	return (
		<Select
			disabled={environments.length === 0}
			onValueChange={onChange}
			value={value ?? undefined}
		>
			<SelectTrigger className={FIELD_WIDTH}>
				<SelectValue
					placeholder={t(
						'settings:repo.infisical.environment-placeholder',
						'Pick an environment',
					)}
				/>
			</SelectTrigger>
			<SelectContent>
				{environments.map((environment) => (
					<SelectItem key={environment.slug} value={environment.slug}>
						{environment.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Folder field for the link, typed as a path and normalised when it loses focus. */
export function InfisicalSecretPathInput({
	onBlur,
	onChange,
	value,
}: {
	onBlur: () => void;
	onChange: (value: string) => void;
	value: string;
}) {
	return (
		<Input
			autoComplete='off'
			className={cn(FIELD_WIDTH, 'font-mono text-xs')}
			id='infisical-secret-path'
			onBlur={onBlur}
			onChange={(event) => onChange(event.target.value)}
			spellCheck={false}
			value={value}
		/>
	);
}

/** Every project one account reaches, as one section of the picker. */
interface ProjectAccountGroup {
	accountId: string;
	accountLabel: string;
	projects: InfisicalProjectSnapshot[];
}

/**
 * Splits an aggregated project list into per-account groups, preserving the
 * order main sorted them into.
 * @param projects - Projects across every configured account.
 * @returns One group per account that owns at least one project.
 */
function groupByAccount(
	projects: InfisicalProjectSnapshot[],
): ProjectAccountGroup[] {
	const accountIds = [...new Set(projects.map((project) => project.accountId))];

	return accountIds.map((accountId) => {
		const owned = projects.filter((project) => project.accountId === accountId);

		return {
			accountId,
			accountLabel: owned.at(0)?.accountLabel ?? accountId,
			projects: owned,
		};
	});
}
