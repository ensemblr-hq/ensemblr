import type { AppLanguage } from '../../shared/i18n';

/**
 * Native menu labels in every shipped language.
 *
 * The main process gets a const table rather than an i18next instance: thirty
 * static strings do not justify booting the library here, pulling the dependency
 * into the main bundle, and keeping a second copy of the catalogues.
 *
 * `{{app}}` is substituted with the application name by {@link menuLabels}.
 *
 * Two macOS-owned submenus are deliberately absent — the `services` menu and
 * `startSpeaking`/`stopSpeaking` cannot be relabelled without forfeiting the
 * system integration, so they stay in the OS language.
 */
const MENU_LABELS = {
	en: {
		about: 'About {{app}}',
		bringAllToFront: 'Bring All to Front',
		closeTab: 'Close Tab',
		copy: 'Copy',
		cut: 'Cut',
		delete: 'Delete',
		edit: 'Edit',
		file: 'File',
		forceReload: 'Force Reload',
		help: 'Help',
		hide: 'Hide {{app}}',
		hideOthers: 'Hide Others',
		minimize: 'Minimize',
		newWorkspace: 'New Workspace',
		openProductRoadmap: 'Open Product Roadmap',
		paste: 'Paste',
		pasteAndMatchStyle: 'Paste and Match Style',
		quit: 'Quit {{app}}',
		redo: 'Redo',
		reload: 'Reload',
		resetZoom: 'Actual Size',
		selectAll: 'Select All',
		speech: 'Speech',
		toggleDevTools: 'Toggle Developer Tools',
		undo: 'Undo',
		unhide: 'Show All',
		view: 'View',
		window: 'Window',
		zoom: 'Zoom',
		zoomIn: 'Zoom In',
		zoomOut: 'Zoom Out',
	},
	ru: {
		about: 'О программе {{app}}',
		bringAllToFront: 'Все окна вперёд',
		closeTab: 'Закрыть вкладку',
		copy: 'Скопировать',
		cut: 'Вырезать',
		delete: 'Удалить',
		edit: 'Правка',
		file: 'Файл',
		forceReload: 'Принудительно перезагрузить',
		help: 'Справка',
		hide: 'Скрыть {{app}}',
		hideOthers: 'Скрыть остальные',
		minimize: 'Свернуть',
		newWorkspace: 'Новая рабочая область',
		openProductRoadmap: 'Открыть дорожную карту',
		paste: 'Вставить',
		pasteAndMatchStyle: 'Вставить и согласовать стиль',
		quit: 'Завершить {{app}}',
		redo: 'Повторить',
		reload: 'Перезагрузить',
		resetZoom: 'Фактический размер',
		selectAll: 'Выбрать все',
		speech: 'Речь',
		toggleDevTools: 'Инструменты разработчика',
		undo: 'Отменить',
		unhide: 'Показать все',
		view: 'Вид',
		window: 'Окно',
		zoom: 'Изменить масштаб',
		zoomIn: 'Увеличить',
		zoomOut: 'Уменьшить',
	},
	el: {
		about: 'Σχετικά με το {{app}}',
		bringAllToFront: 'Όλα σε πρώτο πλάνο',
		closeTab: 'Κλείσιμο καρτέλας',
		copy: 'Αντιγραφή',
		cut: 'Αποκοπή',
		delete: 'Διαγραφή',
		edit: 'Επεξεργασία',
		file: 'Αρχείο',
		forceReload: 'Αναγκαστική επαναφόρτωση',
		help: 'Βοήθεια',
		hide: 'Απόκρυψη {{app}}',
		hideOthers: 'Απόκρυψη άλλων',
		minimize: 'Ελαχιστοποίηση',
		newWorkspace: 'Νέος χώρος εργασίας',
		openProductRoadmap: 'Άνοιγμα οδικού χάρτη',
		paste: 'Επικόλληση',
		pasteAndMatchStyle: 'Επικόλληση με προσαρμογή στιλ',
		quit: 'Τερματισμός {{app}}',
		redo: 'Επανάληψη',
		reload: 'Επαναφόρτωση',
		resetZoom: 'Πραγματικό μέγεθος',
		selectAll: 'Επιλογή όλων',
		speech: 'Ομιλία',
		toggleDevTools: 'Εργαλεία προγραμματιστή',
		undo: 'Αναίρεση',
		unhide: 'Εμφάνιση όλων',
		view: 'Προβολή',
		window: 'Παράθυρο',
		zoom: 'Ζουμ',
		zoomIn: 'Μεγέθυνση',
		zoomOut: 'Σμίκρυνση',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** Every label the native menu renders, for one language. */
export type MenuLabels = (typeof MENU_LABELS)['en'];

/**
 * Resolves the native menu labels for a language, substituting the application
 * name into the three macOS entries that carry it.
 * @param language - The language the app is rendering in
 * @param appName - Application name, as `app.name` reports it
 * @returns Ready-to-render labels for the whole menu
 */
export function menuLabels(language: AppLanguage, appName: string): MenuLabels {
	const labels = MENU_LABELS[language];
	return Object.fromEntries(
		Object.entries(labels).map(([key, value]) => [
			key,
			value.replaceAll('{{app}}', appName),
		]),
	) as MenuLabels;
}
