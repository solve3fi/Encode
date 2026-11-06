import { useLingui } from "@lingui/react";
import { Button } from "@mantine/core";
import { useState } from "react";

export const ClaimButton: React.FC = () => {
	const { i18n } = useLingui();
	const [isDisable, setIsDisable] = useState(true);
	const handleClick = () => {
		setIsDisable(!isDisable);
	};
	return (
		<>
			{isDisable ? (
				<Button bg="gray.10" size="lg" onClick={handleClick}>
					{i18n._("Claim SOLV3")}
				</Button>
			) : (
				<Button size="lg" onClick={handleClick}>
					{i18n._("Claim SOLV3")}
				</Button>
			)}
		</>
	);
};
