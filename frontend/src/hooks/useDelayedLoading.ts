import { useEffect, useRef, useState } from "react";

export const SKELETON_DELAY_MS = 200;
export const SKELETON_MINIMUM_MS = 400;

export function useDelayedLoading(loading: boolean): boolean {
	const [visible, setVisible] = useState(false);
	const shownAt = useRef<number | null>(null);

	useEffect(() => {
		if (loading) {
			const timeout = window.setTimeout(() => {
				shownAt.current = Date.now();
				setVisible(true);
			}, SKELETON_DELAY_MS);
			return () => window.clearTimeout(timeout);
		}

		if (!visible || shownAt.current === null) {
			setVisible(false);
			return;
		}

		const elapsed = Date.now() - shownAt.current;
		const timeout = window.setTimeout(() => {
			shownAt.current = null;
			setVisible(false);
		}, Math.max(0, SKELETON_MINIMUM_MS - elapsed));
		return () => window.clearTimeout(timeout);
	}, [loading, visible]);

	return visible;
}
