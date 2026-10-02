import { useState } from 'react';

/**
 * Avatar tile for a GitHub account, with an image fallback to a tinted swatch.
 * Rounded square rather than a disc, matching `ProjectAvatar` — every other
 * account avatar in the app is that shape.
 */
export function OwnerAvatar({
	avatarUrl,
	ownerLogin,
}: {
	avatarUrl: string | null;
	ownerLogin: string;
}) {
	const [failed, setFailed] = useState(false);

	if (avatarUrl && !failed) {
		return (
			<img
				alt=''
				className='size-5 shrink-0 rounded-sm bg-background object-cover ring-1 ring-foreground/10'
				draggable={false}
				loading='lazy'
				onError={() => setFailed(true)}
				referrerPolicy='no-referrer'
				src={withAvatarSize(avatarUrl, 40)}
			/>
		);
	}

	return (
		<span
			aria-hidden='true'
			className='size-5 shrink-0 rounded-sm ring-1 ring-foreground/10'
			style={{ backgroundColor: ownerAvatarColor(ownerLogin) }}
		/>
	);
}

/** Appends `?s=<size>` to a GitHub avatar URL so we fetch a small thumbnail. */
function withAvatarSize(url: string, size: number): string {
	if (url.includes('?')) {
		return `${url}&s=${size}`;
	}
	return `${url}?s=${size}`;
}

/** Stable color swatch per owner login, derived without external assets. */
function ownerAvatarColor(login: string): string {
	if (!login) {
		return 'oklch(0.5 0.04 260)';
	}
	let hash = 0;
	for (let index = 0; index < login.length; index += 1) {
		hash = (hash * 31 + login.charCodeAt(index)) >>> 0;
	}
	const hue = hash % 360;
	return `oklch(0.62 0.13 ${hue})`;
}
