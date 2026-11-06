"use client";

import { useLingui } from "@lingui/react";
import {
	Avatar,
	Badge,
	Button,
	Group,
	Menu,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import {
	IconArrowsJoin2,
	IconArrowsSplit2,
	IconChevronDown,
	IconChevronUp,
	IconLock,
	IconLockOpen,
	IconRobot,
	IconSelector,
} from "@tabler/icons-react";
import BN from "bn.js";
import sortBy from "lodash/sortBy";
import { DataTable, type DataTableSortStatus } from "mantine-datatable";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TokenPrice } from "@/components/Token/TokenPrice";
import { getLockTokenInfo } from "@/configs/lock";
import { SOLVE, XSOLVE } from "@/configs/tokens";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { type LockAccount, useLocks } from "@/stores/lock/hooks/useLocks";
import { TokenBalance } from "../../Token/TokenBalance";
import classes from "./LockLists.module.css";

export const LockLists: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { data: locks, isLoading } = useLocks();

	const [sortStatus, setSortStatus] = useState<DataTableSortStatus<LockAccount>>({
		columnAccessor: "identifier",
		direction: "asc",
	});
	const [records, setRecords] = useState(sortBy(locks, "identifier"));

	useEffect(() => {
		const data = sortBy(locks, sortStatus.columnAccessor) as LockAccount[];
		setRecords(sortStatus.direction === "asc" ? data.reverse() : data);
	}, [locks, sortStatus]);

	if (!isLoading && records.length === 0) {
		return (
			<Paper p="xl" radius="md" withBorder>
				<Stack align="flex-start" gap="sm">
					<IconLock size={28} stroke={1.5} />
					<Stack gap={4}>
						<Text fw={700}>{i18n._("No locks yet")}</Text>
						<Text c="dimmed">
							{i18n._(
								"Lock SOLV3 to receive permanent veSOLV3 voting power.",
							)}
						</Text>
					</Stack>
					<Button component={Link} href="#create-lock">
						{i18n._("Create a permanent lock")}
					</Button>
				</Stack>
			</Paper>
		);
	}

	return (
		<DataTable
			withTableBorder={false}
			withColumnBorders={false}
			withRowBorders={false}
			className={classes.root}
			rowClassName={classes.row}
			verticalSpacing="md"
			records={records}
			fetching={isLoading}
			sortIcons={{
				sorted: (
					<IconChevronUp
						size={14}
						stroke={2}
						color="var(--mantine-color-purple-8)"
					/>
				),
				unsorted: <IconSelector stroke={2} size={14} />,
			}}
			columns={[
				{
					accessor: "identifier",
					title: i18n._("Lock"),
					width: 240,
					render: ({ identifier, lockTokenMint }) => (
						<Group gap={10}>
							<Avatar.Group>
								<Avatar
									key={getLockTokenInfo(lockTokenMint.toBase58()).symbol}
									src={getLockTokenInfo(lockTokenMint.toBase58()).logoURI}
									title={getLockTokenInfo(lockTokenMint.toBase58()).name}
									size={48}
								/>
							</Avatar.Group>
							<Stack gap={0}>
								<Group gap={4}>
									<Text fw="bold">
										{i18n._("Lock ID")} {identifier.toNumber()}
									</Text>
									<IconLock width={18} height={18} stroke={1.5} />
								</Group>
								<Text c="gray" fz="xs">{i18n._("Permanent lock")}</Text>
							</Stack>
						</Group>
					),
				},
				{
					accessor: "tokenAmount",
					title: i18n._("Locked Amount"),
					sortable: true,
					width: 210,
					render: ({ tokenAmount, lockTokenMint }) => (
						<Stack gap={2}>
							<Text>
								<TokenBalance
									value={tokenAmount
										.div(
											new BN(
												10 **
													getLockTokenInfo(lockTokenMint.toBase58())
														.decimals,
											),
										)
										.toNumber()}
									loading={false}
									suffix={` ${
										getLockTokenInfo(lockTokenMint.toBase58()).symbol
									}`}
								/>
							</Text>
							<Text fz="sm" c="gray">
								<TokenPrice
									addresses={{
										[SOLVE.address]: tokenAmount
											.div(
												new BN(
													10 **
														getLockTokenInfo(lockTokenMint.toBase58())
															.decimals,
												),
											)
											.toNumber(),
									}}
									prefix="$"
									decimalScale={2}
								/>
							</Text>
						</Stack>
					),
				},
				{
					accessor: "lockPower",
					title: i18n._("Voting Power"),
					sortable: true,
					width: 210,
					render: ({ lockPower, lockTokenMint }) => (
						<Stack gap={2}>
							<Text>
								<TokenBalance
									value={lockPower
										.div(
											new BN(
												10 **
													getLockTokenInfo(lockTokenMint.toBase58())
														.decimals,
											),
										)
										.toNumber()}
									loading={false}
									suffix=" veSOLV3"
								/>
							</Text>
							<Text fz="sm" c="gray">
								<TokenPrice
									addresses={{
										[XSOLVE.address]: lockPower
											.div(
												new BN(
													10 **
														getLockTokenInfo(lockTokenMint.toBase58())
															.decimals,
												),
											)
											.toNumber(),
									}}
									prefix="$"
									decimalScale={2}
								/>
							</Text>
						</Stack>
					),
				},
				{
					accessor: "voteUsed",
					title: i18n._("Votes Used"),
					sortable: true,
					render: ({ used }) => (
						<Badge
							variant="outline"
							radius="sm"
							color={used ? "success.8" : "error.8"}
							p={10}
							tt="capitalize"
						>
							{used ? i18n._("Yes") : i18n._("No")}
						</Badge>
					),
				},
				{
					accessor: "action",
					title: "",
					width: 270,
					textAlign: "right",
					render: ({ identifier }) => (
						<Group gap="xs" justify="flex-end" wrap="nowrap">
							<Menu position="bottom-end" withinPortal>
								<Menu.Target>
									<Button size="md" variant="light" style={{ flex: "none" }} rightSection={<IconChevronDown size={16} />}>
										{i18n._("Manage")}
									</Button>
								</Menu.Target>
								<Menu.Dropdown>
									{network === ClusterNetwork.Devnet ? (
										<Menu.Item
											component={Link}
											href={`/lock/auto-vote?lockId=${identifier.toNumber()}`}
											leftSection={<IconRobot size={16} />}
										>
											{i18n._("Auto-Vote")}
										</Menu.Item>
									) : null}
									<Menu.Item
										component={Link}
										href={`/lock/split?lockId=${identifier.toNumber()}`}
										leftSection={<IconArrowsSplit2 size={16} />}
									>
										{i18n._("Split")}
									</Menu.Item>
									<Menu.Item
										component={Link}
										href={`/lock/merge?lockId=${identifier.toNumber()}`}
										leftSection={<IconArrowsJoin2 size={16} />}
									>
										{i18n._("Merge")}
									</Menu.Item>
									<Menu.Divider />
									<Menu.Item
										component={Link}
										href={`/lock/exit?lockId=${identifier.toNumber()}`}
										leftSection={<IconLockOpen size={16} />}
										color="orange"
									>
										{i18n._("Exit")}
									</Menu.Item>
								</Menu.Dropdown>
							</Menu>
							<Button
								size="md"
								variant="filled"
								style={{ flex: "none" }}
								component={Link}
								href={`/vote?lockId=${identifier.toNumber()}`}
							>
								{i18n._("Vote")}
							</Button>
						</Group>
					),
				},
			]}
			sortStatus={sortStatus}
			onSortStatusChange={setSortStatus}
		/>
	);
};
