"use client";

import { useLingui } from "@lingui/react";
import {
	Anchor,
	Button,
	Group,
	Paper,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import { usePartnerVoters } from "@/hooks/usePartnerVoters";
import { formatAddress } from "@/lib/format";
import {
	useAutoVoteChoice,
	useAutoVoters,
	useClearAutoVoter,
	useSetAutoVoter,
} from "@/stores/lock/hooks/useAutoVoters";

const SOLVE3 = "solve3";

/**
 * Lets the owner of an enrolled lock choose who votes it: the Solve3 voter (default) or any registered auto-voter.
 * The 15% auto-vote fee is the same either way and goes to the protocol.
 */
export function AutoVoterChoice({
	lockAddress,
	veTokenId,
	enrolledAt,
	disabled,
}: {
	lockAddress: PublicKey;
	veTokenId: number;
	enrolledAt: number;
	disabled?: boolean;
}) {
	const { i18n } = useLingui();
	const { data: voters = [], isLoading: votersLoading } = useAutoVoters();
	const { data: partnerVoters = [] } = usePartnerVoters();
	const { data: choice, isLoading: choiceLoading } = useAutoVoteChoice(
		lockAddress,
		enrolledAt,
	);
	const setVoter = useSetAutoVoter();
	const clearVoter = useClearAutoVoter();

	const current = choice?.current ? choice.voter : SOLVE3;
	const [selected, setSelected] = useState<string>(current);
	useEffect(() => setSelected(current), [current]);

	const options = useMemo(() => {
		const registered = voters.map((voter) => ({
			value: voter.authority,
			label: formatAddress(voter.authority),
		}));
		// A chosen voter that has since deregistered still shows, so the owner can see why the lock is not voted.
		if (
			current !== SOLVE3 &&
			!registered.some((option) => option.value === current)
		) {
			// A partner voter is not in the public list (partners reach it from their page) but must still show for
			// a lock that chose it; anything else that is missing has deregistered.
			const isPartner = partnerVoters.some((partner) => partner.voter === current);
			registered.push({
				value: current,
				label: isPartner
					? `${i18n._("Solve3 partner voter")} (${formatAddress(current)})`
					: `${formatAddress(current)} (${i18n._("no longer registered")})`,
			});
		}
		return [
			{ value: SOLVE3, label: i18n._("Solve3 voter (default)") },
			...registered,
		];
	}, [voters, partnerVoters, current, i18n]);

	const pending = setVoter.isPending || clearVoter.isPending;
	const save = () => {
		if (selected === current) return;
		if (selected === SOLVE3) clearVoter.mutate({ veTokenId });
		else setVoter.mutate({ veTokenId, voter: new PublicKey(selected) });
	};

	return (
		<Paper p="md" withBorder>
			<Stack gap="sm">
				<Group justify="space-between">
					<Text fw={600}>{i18n._("Who votes this lock")}</Text>
					<Anchor href="/lock/auto-voter" fz="sm">
						{i18n._("Become an auto-voter")}
					</Anchor>
				</Group>
				<Text c="dimmed" fz="sm">
					{i18n._(
						"Pick any registered auto-voter, or keep the Solve3 voter. Only the voter you pick can vote this lock. The 15% fee on its voting rewards goes to the protocol either way.",
					)}
				</Text>
				<Select
					data={options}
					value={selected}
					onChange={(value) => setSelected(value ?? SOLVE3)}
					allowDeselect={false}
					searchable
					disabled={disabled || pending || votersLoading || choiceLoading}
					aria-label={i18n._("Auto-voter")}
				/>
				<Button
					onClick={save}
					loading={pending}
					disabled={disabled || selected === current}
					variant="light"
				>
					{selected === SOLVE3
						? i18n._("Use the Solve3 voter")
						: i18n._("Choose this voter")}
				</Button>
			</Stack>
		</Paper>
	);
}
