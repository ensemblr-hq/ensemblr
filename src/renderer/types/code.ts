import type { ThemedToken } from 'shiki';

/**
 * Highlighted code: the themed token grid. The theme's own surface colours are
 * deliberately absent — code panels paint themselves from the app's `code`
 * tokens so they follow light/dark mode, and take only syntax from the theme.
 */
export interface TokenizedCode {
	tokens: ThemedToken[][];
}
