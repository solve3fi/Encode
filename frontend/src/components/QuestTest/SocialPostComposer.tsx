"use client";

import { useRef, useState } from "react";
import {
	nextDraftIndex,
	SOCIAL_POST_DRAFTS,
	socialPostUrl,
} from "./socialPostDrafts";
import styles from "./SocialPostComposer.module.css";

/** Copy/open are user actions, not proof of posting and never award XP. */
export function SocialPostComposer({ onOpened }: { onOpened?: () => void }) {
	const [index, setIndex] = useState(0);
	const [message, setMessage] = useState("");
	const generation = useRef(0);
	const text = SOCIAL_POST_DRAFTS[index];
	const copy = async () => {
		const attempt = generation.current;
		try {
			await navigator.clipboard.writeText(text);
			if (attempt === generation.current)
				setMessage("Copied. Paste it into your X post.");
		} catch {
			if (attempt === generation.current)
				setMessage(
					"Copy unavailable. Select the draft text and copy it manually.",
				);
		}
	};
	return (
		<div className={styles.composer}>
			<div className={styles.header}>
				<strong>Your next X post</strong>
				<span>
					Draft {index + 1} / {SOCIAL_POST_DRAFTS.length}
				</span>
			</div>
			<p className={styles.draft} aria-label="X post draft">
				{text}
			</p>
			<div className={styles.actions}>
				<button type="button" onClick={() => void copy()}>
					Copy
				</button>
				<button
					type="button"
					onClick={() => {
						generation.current += 1;
						setIndex(nextDraftIndex);
						setMessage("");
					}}
				>
					Reroll
				</button>
				<a
					href={socialPostUrl(text)}
					target="_blank"
					rel="noopener noreferrer"
					onClick={onOpened}
				>
					Open X
				</a>
			</div>
			<p className={styles.hint}>
				Pick a draft, make it yours, then post. Rerolling does not earn extra
				XP.
			</p>
			<p className={styles.status} role="status" aria-live="polite">
				{message}
			</p>
		</div>
	);
}
