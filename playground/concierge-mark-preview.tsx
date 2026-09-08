import { useState } from 'react';

import { cn } from '@/renderer/lib/utils';

import {
	CONCIERGE_MARK_VARIANTS,
	LAUNCHER_FILLS,
	LAUNCHER_SHAPES,
} from './concierge-catalog.tsx';
import {
	ConciergeLauncherShapeStyles,
	LauncherBubble,
} from './concierge-launcher-bubble.tsx';
import {
	ConciergeMarkGhost,
	ConciergeMarkGhostChromatic,
	ConciergeMarkGhostMono,
	ConciergeMarkKeyframes,
} from './concierge-mark-variants.tsx';
import {
	ControlGroup,
	SceneControls,
	SceneOnOff,
	SceneSection,
	SceneToggle,
} from './scene-chrome.tsx';

/**
 * The three sizes the app actually draws the mark at, with the surface each one
 * belongs to. Anything that fails at 16px fails in the panel header, which is
 * where the mark is seen most often.
 */
const SHIPPED_SIZES = [
	{ className: 'size-4', label: '16px · panel header' },
	{ className: 'size-6', label: '24px · empty transcript' },
	{ className: 'size-7', label: '28px · launcher bubble' },
] as const;

/**
 * The legibility ramp, from below the smallest shipped size to well above the
 * largest, so a mark that only works when it is big is obvious.
 */
const RAMP_SIZES = [
	'size-3',
	'size-4',
	'size-5',
	'size-6',
	'size-7',
	'size-10',
] as const;

/** The count the badge carries while the badge control is on. */
const SAMPLE_UNREAD_COUNT = 3;

/**
 * Where the fill sections start from: the pairing picked out of the shape round.
 * Both are steerable from the sidebar, so this is an opening position rather
 * than a hard-coding of somebody's answer.
 */
const DEFAULT_MARK_ID = 'console';
const DEFAULT_SHAPE_ID = 'soft';

/**
 * Every Concierge mark candidate on one canvas, against the shipped one, and
 * every launcher shape the bubble under them could take.
 *
 * The scene draws the launcher bubble, the panel header row, and the empty
 * transcript circle rather than mounting `ConciergeLauncher`, because what is
 * under review is the glyph and the shape rather than the surface they open —
 * `concierge` is the scene that drives the real thing. What it does borrow is
 * the shipped `Button`, the `concierge-sheen` utility and the real
 * `ConciergeUnreadBadge`, so the bubble a candidate is judged on is the bubble
 * it would ship in.
 */
export function ConciergeMarkScene() {
	const [isWorking, setIsWorking] = useState(false);
	const [hasBadge, setHasBadge] = useState(true);
	const [markId, setMarkId] = useState<string>(DEFAULT_MARK_ID);
	const [shapeId, setShapeId] = useState<string>(DEFAULT_SHAPE_ID);

	const badgeCount = hasBadge ? SAMPLE_UNREAD_COUNT : 0;
	const pickedMark =
		CONCIERGE_MARK_VARIANTS.find((variant) => variant.id === markId) ??
		CONCIERGE_MARK_VARIANTS[0];
	const pickedShape =
		LAUNCHER_SHAPES.find((shape) => shape.id === shapeId) ?? LAUNCHER_SHAPES[0];

	return (
		<div className='flex flex-col gap-10'>
			<ConciergeMarkKeyframes />
			<ConciergeLauncherShapeStyles />

			<SceneControls>
				<ControlGroup label='working'>
					<SceneOnOff isOn={isWorking} onChange={setIsWorking} />
				</ControlGroup>
				<ControlGroup label='unread badge'>
					<SceneOnOff isOn={hasBadge} onChange={setHasBadge} />
				</ControlGroup>
				<ControlGroup label='mark'>
					{CONCIERGE_MARK_VARIANTS.map((variant) => (
						<SceneToggle
							isActive={variant.id === pickedMark.id}
							key={variant.id}
							label={variant.label}
							onClick={() => setMarkId(variant.id)}
						/>
					))}
				</ControlGroup>
				<ControlGroup label='shape'>
					{LAUNCHER_SHAPES.map((shape) => (
						<SceneToggle
							isActive={shape.id === pickedShape.id}
							key={shape.id}
							label={shape.label}
							onClick={() => setShapeId(shape.id)}
						/>
					))}
				</ControlGroup>
			</SceneControls>

			<SceneSection
				label={`The bubble fill · ${pickedMark.label} in ${pickedShape.label}`}
				note='Every colour treatment on the mark and shape picked in the sidebar. Primary is the shipped one. The three dark cuts are the app icon’s own body — they differ only in what happens to the glyph sitting on it.'
			>
				<div className='flex flex-wrap gap-8'>
					{LAUNCHER_FILLS.map((fill) => (
						<div
							className='flex w-24 flex-col items-center gap-2'
							key={fill.id}
						>
							<LauncherBubble
								badgeCount={badgeCount}
								fill={fill}
								isWorking={isWorking}
								label={fill.label}
								Mark={pickedMark.Mark}
								shape={pickedShape}
							/>
							<span className='font-mono text-muted-foreground text-xxs'>
								{fill.label}
							</span>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label={`Fill × mark · in ${pickedShape.label}`}
				note='Every fill against every mark, since a fill that carries a four-cell glyph does not necessarily carry an eleven-cell one — Bloom softens edges and Chromatic splits them, and both cost more the denser the mark is.'
			>
				<div className='flex flex-col gap-4'>
					<div className='flex items-center gap-6'>
						<span aria-hidden='true' className='w-20 shrink-0' />
						{CONCIERGE_MARK_VARIANTS.map((variant) => (
							<span
								className='w-11 shrink-0 text-center font-mono text-muted-foreground text-xxs'
								key={variant.id}
							>
								{variant.label}
							</span>
						))}
					</div>
					{LAUNCHER_FILLS.map((fill) => (
						<div className='flex items-center gap-6' key={fill.id}>
							<span className='w-20 shrink-0 font-mono text-muted-foreground text-xxs'>
								{fill.label}
							</span>
							{CONCIERGE_MARK_VARIANTS.map((variant) => (
								<div className='flex w-11 justify-center' key={variant.id}>
									<LauncherBubble
										fill={fill}
										isWorking={isWorking}
										label={`${variant.label} · ${fill.label}`}
										Mark={variant.Mark}
										shape={pickedShape}
									/>
								</div>
							))}
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='What each fill costs'
				note='The case for a fill and the case against it. Three of the six are the same dark body, so read them as one family with three glyph treatments rather than as three separate proposals.'
			>
				<div className='flex flex-col gap-3'>
					{LAUNCHER_FILLS.map((fill) => (
						<div
							className='flex items-start gap-4 rounded-xl border border-border p-4'
							key={fill.id}
						>
							<LauncherBubble
								fill={fill}
								isWorking={isWorking}
								label={fill.label}
								Mark={pickedMark.Mark}
								shape={pickedShape}
							/>
							<div className='flex flex-col gap-1.5'>
								<span className='font-semibold text-sm'>{fill.label}</span>
								<p className='text-muted-foreground text-xs'>{fill.note}</p>
								<p className='text-muted-foreground text-xs'>
									<span className='font-mono text-xxs uppercase tracking-wide'>
										tradeoff ·{' '}
									</span>
									{fill.tradeoff}
								</p>
							</div>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='The toggle shape'
				note='Every shape carrying the shipped mark, so the corner treatment is the only thing changing. Judge the badge here too — it is pinned to the bubble’s shoulder at a fixed offset tuned for a circle, so a squarer corner moves the notch it sits in.'
			>
				<div className='flex flex-wrap gap-8'>
					{LAUNCHER_SHAPES.map((shape) => (
						<div
							className='flex w-24 flex-col items-center gap-2'
							key={shape.id}
						>
							<LauncherBubble
								badgeCount={badgeCount}
								isWorking={isWorking}
								label={shape.label}
								Mark={CONCIERGE_MARK_VARIANTS[0].Mark}
								shape={shape}
							/>
							<span className='font-mono text-muted-foreground text-xxs'>
								{shape.label}
							</span>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='Shape × mark'
				note='The decision surface: every mark in every shape, at the size the app draws them. A mark that carries a circle does not necessarily carry a bevel — the corner competes with the glyph’s own. The badge is deliberately absent here; it is a separate question, answered in the section above.'
			>
				<div className='flex flex-col gap-4'>
					<div className='flex items-center gap-6'>
						<span aria-hidden='true' className='w-20 shrink-0' />
						{CONCIERGE_MARK_VARIANTS.map((variant) => (
							<span
								className='w-11 shrink-0 text-center font-mono text-muted-foreground text-xxs'
								key={variant.id}
							>
								{variant.label}
							</span>
						))}
					</div>
					{LAUNCHER_SHAPES.map((shape) => (
						<div className='flex items-center gap-6' key={shape.id}>
							<span className='w-20 shrink-0 font-mono text-muted-foreground text-xxs'>
								{shape.label}
							</span>
							{CONCIERGE_MARK_VARIANTS.map((variant) => (
								<div className='flex w-11 justify-center' key={variant.id}>
									<LauncherBubble
										isWorking={isWorking}
										label={`${variant.label} · ${shape.label}`}
										Mark={variant.Mark}
										shape={shape}
									/>
								</div>
							))}
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='At the sizes the app ships'
				note='Muted foreground, on the app canvas — the panel header and the empty transcript both draw the mark this way. A candidate that only resolves at 28px is a candidate that only works on the bubble.'
			>
				<div className='flex flex-col gap-4'>
					{CONCIERGE_MARK_VARIANTS.map((variant) => (
						<div className='flex items-center gap-6' key={variant.id}>
							<span className='w-16 shrink-0 font-mono text-muted-foreground text-xxs'>
								{variant.label}
							</span>
							{SHIPPED_SIZES.map((size) => (
								<div
									className='flex w-32 items-center gap-2 text-muted-foreground'
									key={size.label}
								>
									<variant.Mark
										className={size.className}
										isWorking={isWorking}
									/>
									<span className='font-mono text-xxs'>{size.label}</span>
								</div>
							))}
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='Legibility ramp'
				note='12 · 16 · 20 · 24 · 28 · 40px in the foreground colour. Read the left of each row first — the cell count is what decides whether a mark survives the small end.'
			>
				<div className='flex flex-col gap-4'>
					{CONCIERGE_MARK_VARIANTS.map((variant) => (
						<div className='flex items-center gap-4' key={variant.id}>
							<span className='w-16 shrink-0 font-mono text-muted-foreground text-xxs'>
								{variant.label}
							</span>
							{RAMP_SIZES.map((size) => (
								<variant.Mark
									className={cn(size, 'text-foreground')}
									isWorking={isWorking}
									key={size}
								/>
							))}
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='In the panel header and the empty transcript'
				note='The two in-app placements: a 16px mark beside the header title, and a 24px mark inside the 40px circle the transcript shows before the first turn. The circle takes the accent tint while a turn streams, which is what the working toggle drives here.'
			>
				<div className='grid grid-cols-2 gap-4'>
					{CONCIERGE_MARK_VARIANTS.map((variant) => (
						<div
							className='flex items-center gap-4 rounded-xl border border-border p-4'
							key={variant.id}
						>
							<div className='flex items-center gap-1.5'>
								<variant.Mark
									className='mx-1 size-4 shrink-0 text-muted-foreground'
									isWorking={isWorking}
								/>
								<span className='font-medium text-sm'>Concierge</span>
							</div>
							<span
								className={cn(
									'flex size-10 items-center justify-center rounded-full transition-colors',
									isWorking
										? 'bg-accent-strong/15 text-accent-strong'
										: 'bg-muted/60 text-muted-foreground',
								)}
							>
								<variant.Mark className='size-6' isWorking={isWorking} />
							</span>
							<span className='font-mono text-muted-foreground text-xxs'>
								{variant.label}
							</span>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='Ghost · one colour against the icon’s channels'
				note='The same variant at both settings. Tinted, it is the app icon’s own chromatic split and unmistakable; but it stops being a currentColor glyph, so the bubble’s accent fill and the header’s muted grey no longer reach it. Judge whether that trade is worth it before picking Ghost.'
			>
				<div className='flex flex-wrap items-end gap-8'>
					{[false, true].map((chromatic) => (
						<div
							className='flex flex-col items-center gap-3'
							key={chromatic ? 'chromatic' : 'mono'}
						>
							<LauncherBubble
								badgeCount={badgeCount}
								isWorking={isWorking}
								label={chromatic ? 'Ghost · chromatic' : 'Ghost · mono'}
								Mark={
									chromatic
										? ConciergeMarkGhostChromatic
										: ConciergeMarkGhostMono
								}
								shape={LAUNCHER_SHAPES[0]}
							/>
							<div className='flex items-center gap-3 text-muted-foreground'>
								{RAMP_SIZES.map((size) => (
									<ConciergeMarkGhost
										chromatic={chromatic}
										className={size}
										isWorking={isWorking}
										key={size}
									/>
								))}
							</div>
							<span className='font-mono text-muted-foreground text-xxs'>
								{chromatic ? 'chromatic' : 'one colour'}
							</span>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='What each shape costs'
				note='The case for a shape and the case against it. Only Capsule is more than a class swap — it is the one that changes the footprint.'
			>
				<div className='flex flex-col gap-3'>
					{LAUNCHER_SHAPES.map((shape) => (
						<div
							className='flex items-start gap-4 rounded-xl border border-border p-4'
							key={shape.id}
						>
							<LauncherBubble
								badgeCount={badgeCount}
								isWorking={isWorking}
								label={shape.label}
								Mark={CONCIERGE_MARK_VARIANTS[0].Mark}
								shape={shape}
							/>
							<div className='flex flex-col gap-1.5'>
								<span className='font-semibold text-sm'>{shape.label}</span>
								<p className='text-muted-foreground text-xs'>{shape.note}</p>
								<p className='text-muted-foreground text-xs'>
									<span className='font-mono text-xxs uppercase tracking-wide'>
										tradeoff ·{' '}
									</span>
									{shape.tradeoff}
								</p>
							</div>
						</div>
					))}
				</div>
			</SceneSection>

			<SceneSection
				label='What each mark costs'
				note='The case for a variant and the case against it, side by side. A review that only reads the first column is a review of six pitches.'
			>
				<div className='flex flex-col gap-3'>
					{CONCIERGE_MARK_VARIANTS.map((variant) => (
						<div
							className='flex items-start gap-4 rounded-xl border border-border p-4'
							key={variant.id}
						>
							<variant.Mark
								className='mt-0.5 size-6 shrink-0 text-foreground'
								isWorking={isWorking}
							/>
							<div className='flex flex-col gap-1.5'>
								<span className='font-semibold text-sm'>{variant.label}</span>
								<p className='text-muted-foreground text-xs'>{variant.note}</p>
								<p className='text-muted-foreground text-xs'>
									<span className='font-mono text-xxs uppercase tracking-wide'>
										tradeoff ·{' '}
									</span>
									{variant.tradeoff}
								</p>
							</div>
						</div>
					))}
				</div>
			</SceneSection>
		</div>
	);
}
