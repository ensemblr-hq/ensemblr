export type LocaleText = {
	en: string;
	ru?: string;
	el?: string;
};

export type Presentation = {
	version: 1;
	title: LocaleText;
	/** Any valid lowercase kebab-case id from the installed Lucide set. */
	glyph: string;
	preview?: { font: 'mono' | 'sans'; text: LocaleText };
	body?:
		| { kind: 'markdown'; text: LocaleText }
		| {
				kind: 'code';
				language: string;
				code: string;
				startLine?: number | null;
		  }
		| { kind: 'terminal'; text: string }
		| {
				kind: 'labeled';
				sections: Array<{ label: LocaleText; text: string; muted?: boolean }>;
		  };
};

/** Builds the initial snapshot shown before the tool has produced output. */
export function initialPresentation(): Presentation {
	return {
		version: 1,
		title: {
			en: 'Extension search',
			ru: 'Поиск расширения',
			el: 'Αναζήτηση επέκτασης',
		},
		glyph: 'search',
		preview: {
			font: 'mono',
			text: { en: 'starting', ru: 'начало', el: 'έναρξη' },
		},
		body: {
			kind: 'markdown',
			text: {
				en: 'Preparing search…',
				ru: 'Подготовка поиска…',
				el: 'Προετοιμασία αναζήτησης…',
			},
		},
	};
}

/** Builds a complete running snapshot; updates replace the previous snapshot. */
export function runningPresentation(
	query: string,
	count: number,
): Presentation {
	return {
		version: 1,
		title: { en: 'Searching', ru: 'Поиск', el: 'Αναζήτηση' },
		glyph: 'arrow-up-right',
		preview: { font: 'mono', text: { en: query, ru: query, el: query } },
		body: {
			kind: 'terminal',
			text: `searching for ${query}\n${count} result(s) checked`,
		},
	};
}

/** Builds the authoritative final snapshot after successful execution. */
export function finalPresentation(query: string, count: number): Presentation {
	return {
		version: 1,
		title: {
			en: 'Search complete',
			ru: 'Поиск завершён',
			el: 'Η αναζήτηση ολοκληρώθηκε',
		},
		glyph: 'audio-lines',
		preview: {
			font: 'sans',
			text: {
				en: `${count} result(s)`,
				ru: `${count} результат(ов)`,
				el: `${count} αποτέλεσμα(τα)`,
			},
		},
		body: {
			kind: 'labeled',
			sections: [
				{ label: { en: 'Query', ru: 'Запрос', el: 'Ερώτημα' }, text: query },
				{
					label: { en: 'Status', ru: 'Статус', el: 'Κατάσταση' },
					text: 'complete',
				},
			],
		},
	};
}

/** Builds a complete failure snapshot; the host still renders the thrown error. */
export function failurePresentation(): Presentation {
	return {
		version: 1,
		title: {
			en: 'Search failed',
			ru: 'Ошибка поиска',
			el: 'Αποτυχία αναζήτησης',
		},
		glyph: 'circle-x',
		body: {
			kind: 'markdown',
			text: {
				en: 'The host error is authoritative.',
				ru: 'Ошибка хоста имеет приоритет.',
				el: 'Το σφάλμα του κεντρικού υπολογιστή υπερισχύει.',
			},
		},
	};
}
