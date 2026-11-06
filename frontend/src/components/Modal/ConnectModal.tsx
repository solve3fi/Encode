"use client";

import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	Avatar,
	Button,
	Center,
	Group,
	Loader,
	Modal,
	rem,
	Stack,
	Text,
} from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { IconChevronLeft, IconX } from "@tabler/icons-react";
import Image from "next/image";
import { ModalType } from "@/stores/modal";
import { useModal, useModalActions } from "@/stores/modal/ModalProvider";
import { NotFound } from "../Wallet/NotFound";
import { WalletButton } from "../Wallet/WalletButton";

export const ConnectModal: React.FC = () => {
	const openModal = useModal((state) => state.openModal);
	const { closeModal } = useModalActions();

	const { wallets, wallet, connecting, publicKey } = useWallet();
	const { i18n } = useLingui();

	return (
		<Modal.Root
			lockScroll={false}
			opened={openModal === ModalType.WALLET && !publicKey}
			onClose={closeModal}
			centered
			size="sm"
		>
			<Modal.Overlay />
			<Modal.Content
				style={{
					borderWidth: rem(2),
					borderStyle: "solid",
					borderColor: "var(--mantine-color-gray-16)",
				}}
				radius="md"
			>
				<Modal.Header>
					<Group align="center" justify="space-between" w="100%">
						<Image
							src="/assets/images/solve-logo.svg"
							alt="SOLV3"
							width={100}
							height={30}
						/>
						<ActionIcon
							variant="light"
							color="gray"
							aria-label="Close modal"
							onClick={closeModal}
						>
							<IconX size={18} stroke={1.5} />
						</ActionIcon>
					</Group>
				</Modal.Header>
				<Modal.Body>
					{connecting ? (
						<Stack gap={20} justify="center" align="center">
							<Avatar src={wallet?.adapter.icon} size={100} />
							<Loader size={22} />
							<Text size="xl" fw="bold">
								{i18n._("Opening")} {wallet?.adapter.name} {i18n._("wallet")}
							</Text>
							<Text c="gray.14">
								{i18n._("Confirm connection in the extention")}
							</Text>
						</Stack>
					) : (
						<Stack gap={10}>
							<Stack gap={0}>
								<Text fz="lg" fw="bold">
									{i18n._("Connect your wallet")}
								</Text>
								<Text c="gray.14" fz="md" mt={-5}>
									{i18n._("You need to connect a Solana wallet.")}
								</Text>
							</Stack>

							{wallets.length > 0 ? (
								<Stack gap={10} mt={10}>
									<Text fz="lg" fw="bold">
										{i18n._("Popular wallets to get started")}
									</Text>
									<Stack gap={5}>
										{wallets.map((wallet) => (
											<WalletButton key={wallet.adapter.name} {...wallet} />
										))}
									</Stack>
								</Stack>
							) : (
								<NotFound />
							)}
						</Stack>
					)}

					<Center mt={20}>
						<Button
							variant="transparent"
							leftSection={<IconChevronLeft stroke={1.5} />}
							fz="lg"
							onClick={closeModal}
						>
							{i18n._("Go back")}
						</Button>
					</Center>
				</Modal.Body>
			</Modal.Content>
		</Modal.Root>
	);
};
