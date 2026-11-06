import { useCallback, useState } from "react";
export const usePasteClipboard = () => {
	const [pastedText, setPastedText] = useState<string>("");
	const pasteFromClipboard = useCallback(async () => {
		if (navigator.clipboard) {
			const text = await navigator.clipboard.readText();
			setPastedText(text);
		} else {
			setPastedText("");
		}
	}, []);

	return { pasteFromClipboard, pastedText };
};
