import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	Avatar,
	CheckIcon,
	Group,
	Paper,
	Radio,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import Link from "next/link";
import { ALMS } from "@/configs/alms";
import { usePool, usePoolActions } from "@/stores/pool/PoolProvider";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./PoolALM.module.css";

export const PoolALM: React.FC = () => {
	const { i18n } = useLingui();
	const alm = usePool((state) => state.alm);
	const { setAlm } = usePoolActions();

	return (
		<Stack>
			<Text fz="lg" fw="bold">
				{i18n._("Select ALM Provider")}
			</Text>

			{ALMS.map((item) => (
				<UnstyledButton
					key={item.name}
					onClick={() => setAlm(item)}
					className={classes.button}
					w="100%"
				>
					<Stack gap={10} w="100%">
						<Group align="center" justify="space-between">
							<Group gap={10}>
								<Radio
									checked={alm.name === item.name}
									icon={CheckIcon}
									onChange={() => {}}
									tabIndex={-1}
									size="md"
									classNames={{
										root: classes.root,
										label: classes.label,
										radio: classes.radio,
									}}
									aria-hidden
								/>
								<Avatar src={item.logo} alt={item.name} h={24} w="auto" />
							</Group>

							<ActionIcon
								variant="transparent"
								c="gray.12"
								component={Link}
								href={item.url}
							>
								<IconExternalLink />
							</ActionIcon>
						</Group>
						{item.aprToken && (
							<Group
								component={Paper}
								align="center"
								justify="space-between"
								p={5}
								bg="gray.16"
							>
								<Group gap={10}>
									<Avatar
										src={item.aprToken.logoURI}
										alt={item.aprToken.symbol}
										size={24}
									/>
									<Text fz="sm" c="gray">
										{i18n._("APR:")}
									</Text>
								</Group>

								<Text fz="sm" mr={10}>
									<TokenBalance value={44.45} suffix="%" loading={false} />
								</Text>
							</Group>
						)}
					</Stack>
				</UnstyledButton>
			))}
		</Stack>
	);
};
