"use client";

import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	Button,
	Group,
	Modal,
	NumberInput,
	rem,
	SegmentedControl,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { IconHelpCircle, IconHelpTriangle, IconX } from "@tabler/icons-react";
import { DEFAULT_SLIPPAGE, SLIPPAGES } from "@/stores/application";
import {
	useApplication,
	useApplicationActions,
} from "@/stores/application/ApplicationProvider";
import { ModalType } from "@/stores/modal";
import { useModal, useModalActions } from "@/stores/modal/ModalProvider";

export const SlippageModal: React.FC = () => {
	const openModal = useModal((state) => state.openModal);
	const { closeModal } = useModalActions();
	const { setSlippage, setDeadline, reset } = useApplicationActions();
	const deadline = useApplication((state) => state.deadline);
	const slippage = useApplication((state) => state.slippage);
	const { i18n } = useLingui();

	const isDefaultSlippage = (() =>
		SLIPPAGES.includes(slippage === "auto" ? DEFAULT_SLIPPAGE : slippage))();

	return (
		<Modal.Root
			lockScroll={false}
			opened={openModal === ModalType.SLIPPAGE}
			onClose={closeModal}
			centered
			size="md"
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
						<Button variant="light" size="md" color="gray" onClick={reset}>
							{i18n._("Reset")}
						</Button>

						<ActionIcon
							variant="light"
							color="gray"
							size="lg"
							aria-label="Close modal"
							onClick={closeModal}
						>
							<IconX size={18} stroke={1.5} />
						</ActionIcon>
					</Group>
				</Modal.Header>
				<Modal.Body>
					<Stack py={20}>
						<Group gap={2} align="center">
							<Text fw="bold">{i18n._("Slippage tolerance")}</Text>
							<Tooltip
								multiline
								w={220}
								withArrow
								transitionProps={{ duration: 200 }}
								label={i18n._(
									"Slippage tolerance is the maximum difference between the expected and actual price of a trade.",
								)}
							>
								<IconHelpCircle size={16} />
							</Tooltip>
						</Group>

						<Stack gap={0}>
							<Group align="center" justify="space-between" gap={10}>
								<SegmentedControl
									color="purple.10"
									bg="transparent"
									value={(slippage === "auto"
										? DEFAULT_SLIPPAGE
										: slippage
									).toFixed(2)}
									onChange={(value: string) => setSlippage(Number(value))}
									size="lg"
									withItemsBorders={false}
									data={SLIPPAGES.map((value) => ({
										value: value.toFixed(2),
										label: `${value.toFixed(2)}%`,
									}))}
									style={{ flex: 1 }}
								/>

								<NumberInput
									rightSection="%"
									value={
										isDefaultSlippage
											? "0.00"
											: (slippage === "auto"
													? DEFAULT_SLIPPAGE
													: slippage
												).toFixed(2)
									}
									placeholder={"0.00"}
									onChange={(value) => setSlippage(Number(value))}
									size="lg"
									radius="md"
									style={{ width: rem(100) }}
									decimalScale={2}
									fixedDecimalScale
									min={0}
									max={50}
									clampBehavior="strict"
								/>
							</Group>

							{slippage !== "auto" && slippage < 1 && (
								<Text c="error.6" size="sm" component="div">
									<Group gap={2} align="center">
										<IconHelpTriangle stroke={2} size={14} />
										{i18n._("Your transaction may fail")}
									</Group>
								</Text>
							)}
							{!slippage && (
								<Text c="error.6" size="sm" component="div">
									<Group gap={2} align="center">
										<IconHelpTriangle stroke={2} size={14} />
										{i18n._(
											"Please set a slippage value that is within 0% to 50%",
										)}
									</Group>
								</Text>
							)}
						</Stack>

						<Group gap={2} align="center" mt={10}>
							<Text fw="bold">{i18n._("Transaction deadline")}</Text>
							<Tooltip
								multiline
								w={220}
								withArrow
								transitionProps={{ duration: 200 }}
								label={i18n._(
									"Transaction deadline is the maximum time allowed for a transaction to be confirmed.",
								)}
							>
								<IconHelpCircle size={16} />
							</Tooltip>
						</Group>

						<NumberInput
							rightSection={i18n._("minutes")}
							size="lg"
							value={deadline}
							onChange={(value) => setDeadline(Number(value))}
							radius="md"
							style={{ width: rem(200) }}
							fixedDecimalScale={false}
							min={0}
							max={60}
							clampBehavior="strict"
							rightSectionWidth={rem(100)}
						/>
					</Stack>
				</Modal.Body>
			</Modal.Content>
		</Modal.Root>
	);
};
