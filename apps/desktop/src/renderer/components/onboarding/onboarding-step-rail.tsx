import { CheckIcon, MinusIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/renderer/lib/utils';
import type {
	OnboardingScreenId,
	OnboardingStepStatus,
} from '@/renderer/types/onboarding';

/** One stop on the rail. `ready` carries no checks, so it has no gate status. */
export interface OnboardingRailNode {
	id: OnboardingScreenId;
	label: string;
	required: boolean;
	status: OnboardingStepStatus;
}

const DOT_FILL: Record<OnboardingStepStatus, string> = {
	checking: 'bg-accent-strong',
	satisfied: 'bg-status-ok',
	skipped: 'bg-muted-foreground/40',
	unmet: 'bg-muted-foreground/40',
};

/**
 * Sticky progress rail. Node state is the whole navigation affordance — there
 * are no numbers, because a numbered list implies an order the checks do not
 * actually have.
 */
export function OnboardingStepRail({
	activeId,
	nodes,
	onSelect,
}: {
	activeId: OnboardingScreenId;
	nodes: readonly OnboardingRailNode[];
	onSelect: (id: OnboardingScreenId) => void;
}) {
	const { t } = useTranslation();
	const prefersReducedMotion = useReducedMotion();

	return (
		<nav
			aria-label={t('onboarding:rail.label', 'Setup steps')}
			className='flex w-44 shrink-0 flex-col'
		>
			{nodes.map((node, index) => {
				const isActive = node.id === activeId;
				const isLast = index === nodes.length - 1;

				return (
					<div
						className={cn('flex gap-3', isLast ? null : 'min-h-14')}
						key={node.id}
					>
						<div className='flex flex-col items-center'>
							<motion.span
								animate={
									node.status === 'satisfied' && !prefersReducedMotion
										? { scale: [1, 1.14, 1] }
										: { scale: 1 }
								}
								className='flex size-7 shrink-0 items-center justify-center'
								transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
							>
								<NodeGlyph isActive={isActive} status={node.status} />
							</motion.span>
							{isLast ? null : (
								<span
									aria-hidden='true'
									className={cn(
										'my-1.5 w-px flex-1 rounded-full transition-colors duration-300',
										node.status === 'satisfied'
											? 'bg-status-ok/30'
											: 'bg-border',
									)}
								/>
							)}
						</div>
						<button
							aria-current={isActive ? 'step' : undefined}
							className={cn(
								'flex h-7 min-w-0 items-center text-left text-sm transition-colors',
								isActive
									? 'font-medium text-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}
							onClick={() => onSelect(node.id)}
							type='button'
						>
							<span className='truncate'>{node.label}</span>
						</button>
					</div>
				);
			})}
		</nav>
	);
}

/**
 * Horizontal stand-in for the rail, shown once the stage is too narrow to carry
 * a sidebar. Names only the active stop so the row never has to wrap.
 */
export function OnboardingStepStrip({
	activeId,
	nodes,
	onSelect,
}: {
	activeId: OnboardingScreenId;
	nodes: readonly OnboardingRailNode[];
	onSelect: (id: OnboardingScreenId) => void;
}) {
	const { t } = useTranslation();
	const activeIndex = nodes.findIndex((node) => node.id === activeId);
	const activeNode = nodes[activeIndex];

	return (
		<nav
			aria-label={t('onboarding:rail.label', 'Setup steps')}
			className='flex items-center justify-between gap-3'
		>
			<p className='min-w-0 truncate font-medium text-foreground text-sm'>
				{activeNode?.label}
				{activeNode && !activeNode.required ? (
					<span className='ml-2 font-normal text-muted-foreground text-xxs uppercase tracking-wide'>
						{t('onboarding:rail.optional', 'Optional')}
					</span>
				) : null}
			</p>
			<div className='flex shrink-0 items-center gap-1.5'>
				{nodes.map((node) => (
					<button
						aria-current={node.id === activeId ? 'step' : undefined}
						aria-label={node.label}
						className='group/dot flex size-4 items-center justify-center'
						key={node.id}
						onClick={() => onSelect(node.id)}
						type='button'
					>
						<span
							className={cn(
								'rounded-full transition-all duration-300',
								DOT_FILL[node.status],
								node.id === activeId ? 'h-1.5 w-4' : 'size-1.5',
							)}
						/>
					</button>
				))}
			</div>
		</nav>
	);
}

/**
 * The rail node itself. A settled step is a filled disc carrying its glyph; an
 * unsettled one is a bare dot that grows a halo when active. Deliberately never
 * a small dot floating inside a wide ring — that reads as mis-centered however
 * exactly it is placed.
 */
function NodeGlyph({
	isActive,
	status,
}: {
	isActive: boolean;
	status: OnboardingStepStatus;
}) {
	if (status === 'satisfied') {
		return (
			<span className='flex size-5 items-center justify-center rounded-full bg-status-ok text-white'>
				<CheckIcon aria-hidden='true' className='size-3' strokeWidth={3} />
			</span>
		);
	}

	if (status === 'skipped') {
		return (
			<span className='flex size-5 items-center justify-center rounded-full border border-border border-dashed text-muted-foreground'>
				<MinusIcon aria-hidden='true' className='size-3' strokeWidth={3} />
			</span>
		);
	}

	return (
		<span
			aria-hidden='true'
			className={cn(
				'rounded-full transition-all duration-300',
				status === 'checking' && 'size-2.5 animate-pulse bg-accent-strong',
				status === 'unmet' &&
					(isActive
						? 'size-2.5 bg-accent-strong ring-4 ring-accent-strong/15'
						: 'size-2 bg-muted-foreground/35'),
			)}
		/>
	);
}
