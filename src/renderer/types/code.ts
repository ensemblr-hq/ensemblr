import type { ThemedToken } from 'shiki';

/** Highlighted code: the themed token grid plus resolved foreground and background colors. */
export interface TokenizedCode {
	tokens: ThemedToken[][];
	fg: string;
	bg: string;
}
