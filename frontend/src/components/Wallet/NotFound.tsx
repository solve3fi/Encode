import { useLingui } from "@lingui/react";
import { Button, Center, Stack, Text } from "@mantine/core";
import Image from "next/image";
import Link from "next/link";
import { WALLET_DOCS_URL } from "@/utils/externalUrl";

export const NotFound: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack gap={20} mt={10}>
			<Center>
				<Image
					src="/assets/images/wallet.svg"
					width={100}
					height={100}
					alt="Wallet"
				/>
			</Center>
			<Center>
				<Text size="xl" fw="bold">
					{i18n._("New here?")}
				</Text>
			</Center>
			<Text ta="center" c="gray.14">
				{i18n._("Welcome to DEFI create a crypto wallet to get started!")}
			</Text>
			<Button
				component={Link}
				href={WALLET_DOCS_URL}
				target="_blank"
				rel="noopener noreferrer"
				size="lg"
			>
				{i18n._("Get Started")}
			</Button>
		</Stack>
	);
};
