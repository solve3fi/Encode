import { useLingui } from "@lingui/react";
import { ActionIcon, Button, Image } from "@mantine/core";

export const Network: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<>
			<Button
				variant="light"
				leftSection={
					<Image
						src="/assets/tokens/sol-rounded.svg"
						width={24}
						height={24}
						alt="Solana"
					/>
				}
				c="white"
				size="lg"
				tt="uppercase"
				visibleFrom="xs"
				px="md"
			>
				{i18n._("Solana")}
			</Button>
			<ActionIcon
				variant="light"
				p={10}
				size="input-lg"
				radius="xl"
				hiddenFrom="xs"
			>
				<Image src="/assets/tokens/sol.svg" alt="Solana" />
			</ActionIcon>
		</>
	);
};
