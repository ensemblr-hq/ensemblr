import { useCallback, useRef } from 'react';
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
 * Dims a disabled row, for the two vendored primitives that miss it.
 *
 * A plain item and a radio item carry this themselves; a checkbox item and a
 * submenu trigger do not, so a disabled dynamic submenu — "Run Script" with no
 * scripts configured — would otherwise draw exactly like a live one.
 */
const DISABLED_DIM_CLASS = 'data-disabled:opacity-50';

/** Matches the bar's root, which is how a focused row or title is recognized. */
const MENU_BAR_SELECTOR = '[data-slot="menubar"]';

/**
 * The application menu, drawn inside Ensemblr's own title bar.
 *
 * Where the desktop draws no title bar there is nowhere for the platform to put
 * the menu, so the app renders the same tree main built the native menu from.
 * Nothing here decides what a row means or whether it applies: labels, order,
 * enabled state, checkmarks and chords all arrive resolved, which is what keeps
 * this bar and the native one the same menu rather than two that agree by
 * inspection.
 *
 * A chosen row is held from `onSelect` and reported from `onCloseAutoFocus`,
 * after Radix has released focus, with the trigger restore taken over — the
 * same shape the app's other menus use. Every row here is performed across a
 * round trip through main, so the command's own focus move lands a tick or more
 * after the menu closed; leaving Radix to focus the trigger on its own timer
 * makes the two race, and whichever runs last wins. Restoring the element the
 * menu opened over instead settles focus synchronously and leaves the command's
 * move as the only later write. It is also what the row needs to act on: the
 * Edit menu's roles reach `webContents.cut` and friends, which operate on
 * whatever is focused when main handles them, and a focused menu trigger is
 * nothing they can edit.
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
	const openRef = useRef(false);
	const originRef = useRef<HTMLElement | null>(null);
	const pendingRef = useRef<(() => void) | null>(null);

	/**
	 * Records what held focus as the bar is entered, which is where the chosen
	 * row's command will be put back. Runs on the capture phase because Radix
	 * moves focus into the menu while handling the same event, and skips a
	 * reach for a second title while a menu is already open — by then the answer
	 * is the open menu's own panel.
	 *
	 * Focus already inside the bar is not an origin, and the one it found before
	 * stands: a dismissal leaves the trigger focused, so a second open would
	 * otherwise record the trigger and hand the row back the one element the
	 * Edit menu's roles can do nothing with.
	 */
	const rememberOrigin = useCallback(() => {
		if (openRef.current) {
			return;
		}
		const active = document.activeElement;
		const outsideBar =
			active instanceof HTMLElement && !active.closest(MENU_BAR_SELECTOR);

		if (outsideBar) {
			originRef.current = active;
		}
	}, []);

	/**
	 * Tracks whether any menu is open, which is what tells {@link rememberOrigin}
	 * a fresh entry from an in-menu one.
	 * @param value - Id of the open menu, empty once the bar closes
	 */
	const trackOpen = useCallback((value: string) => {
		openRef.current = value !== '';
	}, []);

	/**
	 * Holds the chosen row until the menu releases focus, bound to the render
	 * that drew it so the deferred report still quotes the revision the row was
	 * addressed against rather than one that arrived while the menu was closing.
	 * @param item - The row the user picked
	 */
	const holdChoice = useCallback(
		(item: MenuBarAction) => {
			pendingRef.current = () => onSelect(item);
		},
		[onSelect],
	);

	/**
	 * Puts focus back where the menu found it and reports the held row, or hands
	 * the trigger restore back to Radix when the menu was dismissed without a
	 * choice — which is where returning to the trigger is the right answer.
	 * @param event - Radix's close event, whose default is the trigger restore
	 */
	const reportChoice = useCallback((event: Event) => {
		const report = pendingRef.current;
		pendingRef.current = null;

		if (!report) {
			return;
		}

		event.preventDefault();
		originRef.current?.focus();
		report();
	}, []);

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
			onKeyDownCapture={rememberOrigin}
			onPointerDownCapture={rememberOrigin}
			onValueChange={trackOpen}
		>
			{menuBar.menus.map((menu) => (
				<MenubarMenu key={menu.id}>
					<MenubarTrigger
						className='px-2 py-0.5 font-normal text-muted-foreground text-xs aria-expanded:text-foreground'
						disabled={!menu.enabled}
					>
						{menu.label}
					</MenubarTrigger>
					<MenubarContent onCloseAutoFocus={reportChoice}>
						<MenuBarNodes nodes={menu.items} onChoose={holdChoice} />
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
	onChoose,
}: {
	nodes: readonly MenuBarNode[];
	onChoose: (item: MenuBarAction) => void;
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
						onSelect={() => onChoose(item)}
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
				onChoose={onChoose}
			/>
		),
	);
}

/** Renders a separator, a nested list, or a chooseable row. */
function MenuBarRow({
	inset,
	node,
	onChoose,
}: {
	/** Whether this level reserves a check column the row has to clear. */
	inset: boolean;
	node: MenuBarNode;
	onChoose: (item: MenuBarAction) => void;
}) {
	if (node.kind === 'separator') {
		return <MenubarSeparator />;
	}

	if (node.kind === 'submenu') {
		return (
			<MenubarSub>
				<MenubarSubTrigger
					className={DISABLED_DIM_CLASS}
					disabled={!node.enabled}
					inset={inset}
				>
					{node.label}
				</MenubarSubTrigger>
				<MenubarSubContent>
					<MenuBarNodes nodes={node.items} onChoose={onChoose} />
				</MenubarSubContent>
			</MenubarSub>
		);
	}

	if (node.mark === 'checkbox') {
		return (
			<MenubarCheckboxItem
				checked={node.checked}
				className={DISABLED_DIM_CLASS}
				disabled={!node.enabled}
				onSelect={() => onChoose(node)}
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
			onSelect={() => onChoose(node)}
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
