import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	Button,
	Group,
	Paper,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { AddressUtil } from "@solve3fi/common";
import type { Position } from "@solve3fi/sdk";
import { IconClipboard } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { usePasteClipboard } from "@/hooks/usePasteClipboard";
import { useTransferPosition } from "@/hooks/useTransferPosition";

export type ManagerTransferPanelProps = {
	position: Position;
};

export const ManagerTransferPanel: React.FC<ManagerTransferPanelProps> = ({
	position,
}) => {
	const [error, setError] = useState<string | undefined>(undefined);
	const { pasteFromClipboard, pastedText } = usePasteClipboard();
	const [receiver, setReceiver] = useState<string | undefined>();
	const { i18n } = useLingui();

	const handleReceiverChange = useCallback(
		(value: string) => {
			setReceiver(value);
			setError(undefined);
			try {
				value && AddressUtil.toPubKey(value);
			} catch {
				setError(i18n._("Invalid receiver address"));
			}
		},
		[i18n],
	);

	useEffect(() => {
		handleReceiverChange(pastedText);
	}, [pastedText, handleReceiverChange]);

	const { mutate: transferPosition, isPending } = useTransferPosition();

	return (
		<Stack gap={12}>
			<Text fz="lg" fw="bold" tt="capitalize">
				{i18n._("Transfer Liquidity")}
			</Text>

			<Paper p="md" shadow="sm" bg="dark.10">
				<Group align="center" gap={0}>
					<Text>{i18n._("Receiver Address")}</Text>
					<TextInput
						size="lg"
						fw="bold"
						variant="unstyled"
						placeholder="0x..."
						value={receiver}
						onChange={(event) =>
							handleReceiverChange(event.currentTarget.value)
						}
						w="100%"
						rightSection={
							<ActionIcon
								variant="transparent"
								size="input-lg"
								radius="xl"
								fz="xs"
								onClick={pasteFromClipboard}
							>
								<IconClipboard />
							</ActionIcon>
						}
					/>
				</Group>

				{error && (
					<Text fz="xs" fw={500} c="red">
						{error}
					</Text>
				)}
			</Paper>

			<Button
				fullWidth
				size="lg"
				loading={isPending}
				disabled={!!error || !receiver}
				onClick={() =>
					transferPosition({
						position,
						receiver: AddressUtil.toPubKey(receiver ?? ""),
					})
				}
			>
				{i18n._("Transfer Liquidity")}
			</Button>
		</Stack>
	);
};
