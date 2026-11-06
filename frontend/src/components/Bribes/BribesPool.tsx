"use client";

import { useLingui } from "@lingui/react";
import {
	Avatar,
	AvatarGroup,
	Combobox,
	Group,
	Input,
	InputBase,
	ScrollArea,
	Stack,
	Text,
	Title,
	useCombobox,
} from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAllTokens } from "@/hooks/useToken";
import { useCluster } from "@/providers/ClusterProvider";
import { usePools } from "@/stores/pool/hooks/usePools";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVotes, type VoteInfo } from "@/stores/vote/hooks/useVotes";

export type PoolItem = {
	images: string[] | undefined;
	value: string;
	id: string;
	fee: number;
};

export const SelectOption: React.FC<{ item: PoolItem }> = ({ item }) => {
	return (
		<Group gap={10}>
			<AvatarGroup>
				{item.images?.map((image) => (
					<Avatar key={image} size={32} src={image} />
				))}
			</AvatarGroup>
			<Group gap={5}>
				<Text fw="bold">{item.value}</Text>
				<Text fw="bold">({item.fee}%)</Text>
			</Group>
		</Group>
	);
};

export const BribesPool: React.FC<{
	onSelected: (pool: string) => void;
}> = ({ onSelected }) => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const tokenMap = useAllTokens();

	const { data: voteConfig } = useVoteConfig(network);
	const { data: votes } = useVotes(network, voteConfig?.epoch.toNumber() || 0);
	const { data: pools } = usePools(
		network,
		votes?.map((item) => item.pool.toBase58()) || [],
	);

	// pool.tokenAInfo/tokenBInfo/feeTier aren't set on the raw Solve object
	// from usePools — same fix as VoteLists.tsx: resolve real symbols from
	// the token registry (falling back to a truncated address) and compute
	// feeTier from the pool's own on-chain feeRate.
	const resolveTokenDisplay = (mint: string) =>
		tokenMap[mint] ?? {
			chainId: 0,
			address: mint,
			symbol: `${mint.slice(0, 4)}…`,
			name: mint,
			decimals: 0,
		};

	const votesList = useMemo(() => {
		return pools?.map((pool) => {
			const poolData = pool.getData();
			return Object.assign(pool, {
				tokenAInfo: resolveTokenDisplay(poolData.tokenMintA.toBase58()),
				tokenBInfo: resolveTokenDisplay(poolData.tokenMintB.toBase58()),
				// feeRate is in hundredths of a basis point (1,000,000 = 100%), so
				// /10000 gives a plain percent (3000 -> 0.3%, 10000 -> 1%) — same
				// conversion as AdminAddGauge.tsx.
				feeTier: { fee: poolData.feeRate / 10000 },
				vote: votes?.find((vote) => vote.pool.equals(pool.getAddress())),
			});
		}) as VoteInfo[];
		// tokenMap intentionally omitted: useAllTokens() returns a new object
		// reference every render, so depending on it here would infinite-loop
		// (see VoteLists.tsx for the same fix).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pools, votes]);

	const [value, setValue] = useState<string | null>(null);
	const [search, setSearch] = useState<string>("");
	const requestedPool = useSearchParams().get("pool");

	// Only default to the first pool once. votesList/pools/votes are refetched
	// on a 15s interval and each refetch returns a new array reference even
	// when the data is unchanged, so depending on votesList's identity here
	// re-ran this on every background refetch -- silently resetting the
	// submitted pool back to votesList[0] behind the user's back if they took
	// more than ~15s to fill out the form, while the dropdown kept visually
	// showing whatever they'd actually clicked (that's just local Combobox
	// state, untouched by this). A bribe would then fund a completely
	// different gauge than the one displayed as selected, with no error and
	// no indication anything was wrong.
	const hasAutoSelected = useRef(false);
	useEffect(() => {
		if (hasAutoSelected.current || !votesList?.length) return;
		hasAutoSelected.current = true;
		const requested = requestedPool
			? votesList.find((item) => item.getAddress().toBase58() === requestedPool)
			: undefined;
		const firstId = (requested ?? votesList[0])?.getAddress().toBase58();
		setValue(firstId);
		onSelected(firstId);
	}, [onSelected, votesList, requestedPool]);

	const poolItems = useMemo(
		() =>
			votesList?.map((pool) => ({
				id: pool.getAddress().toBase58(),
				images: [pool.tokenAInfo.logoURI, pool.tokenBInfo.logoURI],
				value: `${pool.tokenAInfo.symbol}/${pool.tokenBInfo.symbol}`,
				fee: pool.feeTier.fee,
			})) as PoolItem[],
		[votesList],
	);

	const combobox = useCombobox({
		onDropdownClose: () => {
			combobox.resetSelectedOption();
			combobox.focusTarget();
			setSearch("");
		},

		onDropdownOpen: () => {
			combobox.focusSearchInput();
		},
	});

	const selectedOption =
		poolItems?.find((item) => item.id === value) || poolItems?.[0];

	const options = poolItems
		?.filter((item) => item.value.includes(search.toLowerCase().trim()))
		.map((item) => (
			<Combobox.Option value={item.id} key={item.id}>
				<SelectOption item={item} />
			</Combobox.Option>
		));

	return (
		<Stack gap={12}>
			<Title size="md">{i18n._("Choose Pool")}</Title>

			<Combobox
				store={combobox}
				withinPortal={true}
				transitionProps={{ duration: 200, transition: "pop" }}
				onOptionSubmit={(val) => {
					setValue(val);
					onSelected(val);
					combobox.closeDropdown();
				}}
			>
				<Combobox.Target>
					<InputBase
						component="button"
						type="button"
						size="lg"
						pointer
						rightSection={<IconChevronDown />}
						onClick={() => combobox.toggleDropdown()}
						rightSectionPointerEvents="none"
					>
						{selectedOption ? (
							<SelectOption item={selectedOption} />
						) : (
							<Input.Placeholder fz="md">
								{i18n._("Pick pool")}
							</Input.Placeholder>
						)}
					</InputBase>
				</Combobox.Target>

				<Combobox.Dropdown>
					<Combobox.Search
						value={search}
						onChange={(event) => setSearch(event.currentTarget.value)}
						placeholder={i18n._("Search pool")}
					/>
					<Combobox.Options>
						<ScrollArea.Autosize mah={200} type="scroll">
							{options?.length > 0 ? (
								options
							) : (
								<Combobox.Empty>{i18n._("Pool not found")}</Combobox.Empty>
							)}
						</ScrollArea.Autosize>
					</Combobox.Options>
				</Combobox.Dropdown>
			</Combobox>
		</Stack>
	);
};
