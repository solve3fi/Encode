import { useLingui } from "@lingui/react";
import {
	Avatar,
	Divider,
	Group,
	Paper,
	RingProgress,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import type React from "react";
import { useEffect, useState } from "react";

export type JupiterPriceFeedProps = {
	inputMint?: TokenInfo | null;
	outputMint?: TokenInfo | null;
	amount: BN;
	slippage: number;
	onUsePrice?: (price: number) => void;
};

export const JupiterPriceFeed: React.FC<JupiterPriceFeedProps> = ({
	inputMint,
	outputMint,
	slippage,
	amount,
	onUsePrice,
}) => {
	const { i18n } = useLingui();
	const { data, isFetched, isError, refetch } = useQuery({
		queryKey: [
			"jupiter-price-feed",
			inputMint?.address,
			outputMint?.address,
			slippage,
		],
		queryFn: async () =>
			await fetch(
				`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint?.address}&outputMint=${outputMint?.address}&amount=${amount.toString()}&slippageBps=${slippage}`,
			).then((res) => res.json()),

		enabled: !!inputMint && !!outputMint && amount.gt(new BN(0)),
		retry: false,
	});

	// A brand-new pair has no route through any DEX Jupiter aggregates, so the
	// swap-quote above legitimately finds nothing — that's not the same as
	// having no price. Jupiter's price API prices each mint independently
	// (its own oracle/aggregation, no route required), so it can still give a
	// rough reference for a pair nobody has ever swapped between.
	const quoteFailed = isFetched && (isError || !data?.outAmount);
	const { data: priceData, isFetched: priceFetched } = useQuery({
		queryKey: [
			"jupiter-price-feed-fallback",
			inputMint?.address,
			outputMint?.address,
		],
		queryFn: async () =>
			await fetch(
				`https://api.jup.ag/price/v2?ids=${inputMint?.address},${outputMint?.address}`,
			).then((res) => res.json()),
		enabled: quoteFailed && !!inputMint && !!outputMint,
		retry: false,
	});
	const fallbackPrice = (() => {
		const inputPrice = Number(
			priceData?.data?.[inputMint?.address ?? ""]?.price,
		);
		const outputPrice = Number(
			priceData?.data?.[outputMint?.address ?? ""]?.price,
		);
		if (
			!Number.isFinite(inputPrice) ||
			!Number.isFinite(outputPrice) ||
			outputPrice <= 0
		) {
			return undefined;
		}
		return inputPrice / outputPrice;
	})();

	const [progress, setProgress] = useState<number>(0);
	useEffect(() => {
		const timer = setInterval(() => {
			setProgress((prev) => {
				if (prev >= 15) {
					refetch();
					return 0;
				}
				return prev + 1;
			});
		}, 1000);

		return () => clearInterval(timer);
	}, [refetch]);

	if (quoteFailed && fallbackPrice) {
		return (
			<Paper p="md" shadow="sm" bg="dark.10">
				<Stack gap={10}>
					<Group justify="space-between">
						<Text fz="sm">{i18n._("Reference price (no direct route)")}</Text>
						<UnstyledButton fz="sm" onClick={() => onUsePrice?.(fallbackPrice)}>
							{i18n._("Use this price")}
						</UnstyledButton>
					</Group>
					<Group gap={5} align="center">
						<Text fz="lg" fw={600}>
							{fallbackPrice.toPrecision(6)}
						</Text>
						<Text fz="xs" c="gray">
							{outputMint?.symbol}{" "}
							<Text span inherit>
								{i18n._("per")}{" "}
							</Text>
							<Text span inherit>
								{inputMint?.symbol}
							</Text>
						</Text>
					</Group>
					<Group gap={8} align="center" wrap="nowrap">
						<Avatar
							src="/assets/icons/jupiter-logo.svg"
							alt="jupiter"
							size={24}
							style={{ flexShrink: 0 }}
						/>
						<Text fz="xs" c="gray">
							{i18n._(
								"No swap route exists for this pair yet, so this is derived from each token's independent Jupiter price rather than a direct market rate. Verify before using it.",
							)}
						</Text>
					</Group>
				</Stack>
			</Paper>
		);
	}

	if (quoteFailed && priceFetched && !fallbackPrice) {
		return (
			<Group gap={8} align="center" wrap="nowrap">
				<Avatar
					src="/assets/icons/jupiter-logo.svg"
					alt="jupiter"
					size={24}
					style={{ flexShrink: 0 }}
				/>
				<Text fz="xs" c="gray">
					{i18n._(
						"No live market price found for this pair. Enter the starting price manually above.",
					)}
				</Text>
			</Group>
		);
	}

	return (
		data?.outAmount && (
			<Paper p="md" shadow="sm" bg="dark.10">
				<Stack gap={10}>
					<Stack gap={5}>
						<Group justify="space-between">
							<Text fz="sm">{i18n._("Estimated Market Price")}</Text>
							<UnstyledButton
								fz="sm"
								onClick={() =>
									onUsePrice?.(
										DecimalUtil.fromNumber(
											data?.outAmount,
											outputMint?.decimals,
										).toNumber(),
									)
								}
							>
								{i18n._("Use this price")}
							</UnstyledButton>
						</Group>

						<Group gap={5} align="center">
							<RingProgress
								sections={[
									{
										value: (progress / 15) * 100,
										color: "blue",
									},
								]}
								rootColor="dark.10"
								thickness={3}
								size={25}
							/>
							<Text fz="lg" fw={600}>
								{DecimalUtil.fromNumber(
									data?.outAmount,
									outputMint?.decimals,
								).toString()}
							</Text>
							<Text fz="xs" c="gray">
								{outputMint?.symbol}{" "}
								<Text span inherit>
									{i18n._("per")}{" "}
								</Text>
								<Text span inherit>
									{inputMint?.symbol}
								</Text>
							</Text>
						</Group>
					</Stack>
					<Divider color="dark." />

					<Group gap={8} align="center" wrap="nowrap">
						<Avatar
							src="/assets/icons/jupiter-logo.svg"
							alt="jupiter"
							size={24}
							style={{ flexShrink: 0 }}
						/>
						<Text fz="xs" c="gray">
							{i18n._(
								"This price was calculated based on market rates from Jupiter. Please verify the price before using it.",
							)}
						</Text>
					</Group>
				</Stack>
			</Paper>
		)
	);
};
