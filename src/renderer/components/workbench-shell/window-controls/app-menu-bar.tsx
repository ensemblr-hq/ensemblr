import { useTranslation } from 'react-i18next';

import {
	Menubar,
	MenubarCheckboxItem,
	MenubarContent,
	MenubarItem,
	MenubarMenu,
	MenubarRadioGroup,
	MenubarRadioItem,
	MenubarSeparator,
	MenubarShortcut,
	MenubarSub,
	MenubarSubContent,
	MenubarSubTrigger,
	MenubarTrigger,
} from '@/renderer/components/ui/menubar';
import { cn } from '@/renderer/lib/utils';
import type {
	MenuBarAction,
	MenuBarDescriptor,
	MenuBarNode,
} from '@/shared/menu-bar';

/**
 * The application menu, drawn inside Ensemblr's own title bar.
 *
 * Where the desktop draws no title bar there is nowhere for the platform to put
 * the menu, so the app renders the same tree main built the native menu from.
 * Nothing here decides what a row means or whether it applies: labels, order,
 * enabled state, checkmarks and chords all arrive resolved, which is what keeps
 * this bar and the native one the same menu rather than two that agree by
 * inspection.
 */
export function AppMenuBar({
	className,
	menuBar,
	onSelect,
}: {
	className?: string;
	menuBar: MenuBarDescriptor;
	onSelect: (item: MenuBarAction) => void;
}) {
	const { t } = useTranslation();

	if (menuBar.menus.length === 0) {
		return null;
	}

	return (
		<Menubar
			aria-label={t('workbench:menu-bar.group', 'Application menu')}
			className={cn(
				'h-full gap-0 rounded-none border-0 bg-transparent p-0',
				className,
			)}
		>
			{menuBar.menus.map((menu) => (
				<MenubarMenu key={menu.id}>
					<MenubarTrigger
						className='px-2 py-0.5 font-normal text-muted-foreground text-xs aria-expanded:text-foreground'
						disabled={!menu.enabled}
					>
						{menu.label}
					</MenubarTrigger>
					<MenubarContent>
						<MenuBarNodes nodes={menu.items} onSelect={onSelect} />
					</MenubarContent>
				</MenubarMenu>
			))}
		</Menubar>
	);
}

/**
 * Renders one level of the menu tree, gathering each run of one-of-N rows into
 * a radio group so the theme, panel and status choices announce themselves as
 * the single choice they are rather than as loose checkboxes.
 *
 * A level holding any marked row reserves the check column for all of them, the
 * way a desktop menu does: the alternative is Run sitting a check's width to the
 * right of Run Script directly beneath it.
 */
function MenuBarNodes({
	nodes,
	onSelect,
}: {
	nodes: readonly MenuBarNode[];
	onSelect: (item: MenuBarAction) => void;
}) {
	const hasMarks = nodes.some(
		(node) => node.kind === 'action' && node.mark !== undefined,
	);

	return groupRadioRuns(nodes).map((group) =>
		Array.isArray(group) ? (
			<MenubarRadioGroup
				key={group[0].id}
				value={group.find((item) => item.checked)?.id ?? ''}
			>
				{group.map((item) => (
					<MenubarRadioItem
						disabled={!item.enabled}
						key={item.id}
						onSelect={() => onSelect(item)}
						value={item.id}
					>
						{item.label}
						<MenuBarChord accelerator={item.accelerator} />
					</MenubarRadioItem>
				))}
			</MenubarRadioGroup>
		) : (
			<MenuBarRow
				inset={hasMarks}
				key={group.id}
				node={group}
				onSelect={onSelect}
			/>
		),
	);
}

/** Renders a separator, a nested list, or a chooseable row. */
function MenuBarRow({
	inset,
	node,
	onSelect,
}: {
	/** Whether this level reserves a check column the row has to clear. */
	inset: boolean;
	node: MenuBarNode;
	onSelect: (item: MenuBarAction) => void;
}) {
	if (node.kind === 'separator') {
		return <MenubarSeparator />;
	}

	if (node.kind === 'submenu') {
		return (
			<MenubarSub>
				<MenubarSubTrigger disabled={!node.enabled} inset={inset}>
					{node.label}
				</MenubarSubTrigger>
				<MenubarSubContent>
					<MenuBarNodes nodes={node.items} onSelect={onSelect} />
				</MenubarSubContent>
			</MenubarSub>
		);
	}

	if (node.mark === 'checkbox') {
		return (
			<MenubarCheckboxItem
				checked={node.checked}
				// The vendored primitive dims a disabled item everywhere but here.
				className='data-disabled:opacity-50'
				disabled={!node.enabled}
				onSelect={() => onSelect(node)}
			>
				{node.label}
				<MenuBarChord accelerator={node.accelerator} />
			</MenubarCheckboxItem>
		);
	}

	return (
		<MenubarItem
			disabled={!node.enabled}
			inset={inset}
			onSelect={() => onSelect(node)}
		>
			{node.label}
			<MenuBarChord accelerator={node.accelerator} />
		</MenubarItem>
	);
}

/** The chord shown at a row's trailing edge, absent when the row claims none. */
function MenuBarChord({ accelerator }: { accelerator?: string }) {
	if (!accelerator) {
		return null;
	}
	return <MenubarShortcut>{accelerator}</MenubarShortcut>;
}

/** A run of adjacent one-of-N rows, or a single row of any other kind. */
type MenuBarGroup = MenuBarNode | MenuBarAction[];

/**
 * Gathers each run of adjacent radio rows into one array, leaving every other
 * row alone. Radix needs the run wrapped in a group that owns the selected
 * value, which a flat list of rows cannot express.
 * @param nodes - The rows at one level of the tree
 * @returns The same rows, with radio runs collected
 */
function groupRadioRuns(nodes: readonly MenuBarNode[]): MenuBarGroup[] {
	const groups: MenuBarGroup[] = [];

	for (const node of nodes) {
		if (node.kind !== 'action' || node.mark !== 'radio') {
			groups.push(node);
			continue;
		}

		const open = groups.at(-1);
		if (Array.isArray(open)) {
			open.push(node);
			continue;
		}
		groups.push([node]);
	}

	return groups;
}
