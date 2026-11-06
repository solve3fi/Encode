"use client";

import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	CloseButton,
	Group,
	Input,
	Modal,
	rem,
	ScrollArea,
	Stack,
	Text,
} from "@mantine/core";
import type { Address } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconSearch, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { TokenMap } from "@/hooks/useToken";
import { isListedInTokenPicker } from "@/lib/tokenPicker";
import { ModalType } from "@/stores/modal";
import { useModal, useModalActions } from "@/stores/modal/ModalProvider";
import { BaseTokenList } from "../Token/BaseTokenList";
import { CustomToken } from "../Token/CustomToken";
import { TokenList } from "../Token/TokenList";

export type TokenAssetModalProps = {
	tokenLists: TokenMap;
	pinTokens?: TokenInfo[];
	search?: boolean;
	title: string;
	selectToken: (token: Address) => void;
	isTokenAllowed?: (token: TokenInfo) => boolean;
};

export const TokenAssetModal: React.FC<TokenAssetModalProps> = ({
	tokenLists,
	pinTokens,
	search,
	title,
	selectToken,
	isTokenAllowed = () => true,
}) => {
	const openModal = useModal((state) => state.openModal);
	const { closeModal } = useModalActions();
	const [filter, setFilter] = useState<string>("");
	const { i18n } = useLingui();

	const handleSelectToken = (token: TokenInfo) => {
		if (!isTokenAllowed(token)) return;
		selectToken(token.address);
		closeModal();
	};

	const tokens = useMemo(() => {
		const listedTokens = Object.values(tokenLists).filter(
			(token) => isListedInTokenPicker(token) && isTokenAllowed(token),
		);
		const query = filter.trim().toLowerCase();
		return query
			? listedTokens.filter(
					(token) =>
						token.symbol.toLowerCase().includes(query) ||
						token.name.toLowerCase().includes(query) ||
						token.address.toLowerCase().includes(query),
				)
			: listedTokens;
	}, [filter, tokenLists, isTokenAllowed]);

	return (
		<Modal.Root
			lockScroll={false}
			opened={openModal === ModalType.TOKENS}
			onClose={closeModal}
			centered
			size={480}
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
				<Modal.Header px="lg">
					<Group align="center" justify="space-between" w="100%">
						<Text size="xl" fw={700}>
							{title}
						</Text>
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
				<Modal.Body px="lg" pb={40}>
					<Stack gap={20}>
						{search && (
							<Input
								placeholder={i18n._("Search by name or paste address")}
								leftSection={
									<IconSearch color="var(--mantine-color-purple-9)" />
								}
								value={filter}
								onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
									setFilter(event.currentTarget.value)
								}
								fw={600}
								size="lg"
								rightSectionPointerEvents="all"
								rightSection={
									filter ? (
										<CloseButton
											aria-label="Clear input"
											onClick={() => setFilter("")}
										/>
									) : undefined
								}
							/>
						)}
						{pinTokens && (
							<Group gap={10} mb={10}>
								{pinTokens
									.filter(
										(token) =>
											isListedInTokenPicker(token) && isTokenAllowed(token),
									)
									.map((token) => (
										<BaseTokenList
											key={token.address}
											token={token}
											onSelected={handleSelectToken}
										/>
									))}
							</Group>
						)}
						<ScrollArea h={280}>
							<Stack gap={20}>
								{tokens.length ? (
									tokens.map((token) => (
										<TokenList
											key={token.address}
											token={token}
											onSelected={handleSelectToken}
										/>
									))
								) : (
									<CustomToken
										address={filter}
										handleSelectToken={handleSelectToken}
										isTokenAllowed={isTokenAllowed}
									/>
								)}
							</Stack>
						</ScrollArea>
					</Stack>
				</Modal.Body>
			</Modal.Content>
		</Modal.Root>
	);
};
