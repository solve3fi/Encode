"use client";

import { useLingui } from "@lingui/react";
import { Avatar, Button, Group, Stack, Text } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { DataTable } from "mantine-datatable";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./ClaimTable.module.css";

export type ClaimInfo = {
	tokenInfo: {
		name: string;
		logoImg: string;
	};
	lockID: string;
	unlockDate: string;
	waitingToken: number;
	claimToken: number;
};

export type ClaimTableProps = {
	claims: ClaimInfo[] | undefined;
	loading?: boolean;
};

export const ClaimTable: React.FC<ClaimTableProps> = ({ claims, loading }) => {
	const { i18n } = useLingui();

	return (
		<DataTable
			withTableBorder={false}
			withColumnBorders={false}
			withRowBorders={false}
			className={classes.root}
			rowClassName={classes.row}
			verticalSpacing="md"
			records={claims}
			fetching={loading}
			columns={[
				{
					accessor: "tokenInfo",
					title: i18n._("Rewards"),
					width: 240,
					render: (claims: ClaimInfo) => (
						<Group gap={10}>
							<Avatar
								key={claims.tokenInfo.name}
								src={claims.tokenInfo.logoImg}
								title={claims.tokenInfo.name}
								size={48}
							/>

							<Group gap={4} align="center">
								<Text fw="bold" fz="sm">
									{i18n._("Lock ID {id}", { id: claims.lockID })}
								</Text>
								<IconLock height={16} width={16} />
							</Group>
						</Group>
					),
				},

				{
					accessor: "unlockDate",
					title: i18n._("Unlock date"),
					width: 240,
					render: ({ unlockDate }) => (
						<Text fw="bold" fz="sm">
							{unlockDate}
						</Text>
					),
				},

				{
					accessor: "waitingToken",
					title: i18n._("Waiting"),
					render: ({ waitingToken }: ClaimInfo) => (
						<Stack gap={2}>
							<Text fw="bold" fz="sm">
								<TokenBalance
									value={waitingToken}
									loading={false}
									suffix="SOLV3"
								/>
							</Text>
							<Text fz="xs" fw={400} lh={1} c="gray">On-chain amount</Text>
						</Stack>
					),
				},

				{
					accessor: "claimableToken",
					title: i18n._("Claimable"),
					render: ({ claimToken }: ClaimInfo) => (
						<Stack gap={2}>
							<Text fw="bold" fz="sm">
								<TokenBalance
									value={claimToken}
									loading={false}
									suffix="SOLV3"
								/>
							</Text>
							<Text fz="xs" fw={400} lh={1} c="gray">On-chain amount</Text>
						</Stack>
					),
				},

				{
					accessor: "action",
					title: "",
					width: 160,
					render: () => (
						<Button
							size="lg"
							variant="filled"
							disabled
						>
							{i18n._("Claim UI pending")}
						</Button>
					),
				},
			]}
		/>
	);
};
