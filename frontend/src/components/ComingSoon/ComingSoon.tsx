import { Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { IconArrowsExchange, IconDroplet } from "@tabler/icons-react";
import Link from "next/link";
import { GATED_FEATURES, type GatedFeature } from "@/configs/launchPhase";
import { AppLayout } from "../Layout/AppLayout";
import { BoxLayout } from "../Layout/BoxLayout";
import { CardLayout } from "../Layout/CardLayout";
import { StatusChip } from "../ProtocolStatus/StatusChip";
import classes from "./ComingSoon.module.css";

type ComingSoonProps = {
	feature: GatedFeature | null;
};

// Body served (via the middleware rewrite) for every gated ve route during
// the DEX-only soft launch. Server component: copy comes straight from the
// GATED_FEATURES registry so it stays in step with what the middleware gates.
export const ComingSoon: React.FC<ComingSoonProps> = ({ feature }) => {
	const info = feature ? GATED_FEATURES[feature] : null;
	const title = info ? info.title : "Not open yet";
	const blurb = info
		? info.blurb
		: "This part of Solve3 opens with the veSOLV3 launch.";

	return (
		<AppLayout>
			<Container mx="auto" size="xl">
				<BoxLayout>
					<CardLayout className={classes.card}>
						<Stack gap="lg" align="flex-start" className={classes.inner}>
							<StatusChip tone="pending" pulse>
								Coming soon
							</StatusChip>
							<Title order={1} className={classes.title}>
								{title}
							</Title>
							<Text className={classes.blurb}>{blurb}</Text>
							<Text className={classes.note}>
								During the soft launch, Swap and Liquidity Pools are live on
								Solana. Everything else arrives with the veSOLV3 launch.
							</Text>
							<Group gap={10} className={classes.actions}>
								<Button
									component={Link}
									href="/swap"
									size="lg"
									color="purple.9"
									leftSection={<IconArrowsExchange size={20} stroke={1.6} />}
								>
									Swap tokens
								</Button>
								<Button
									component={Link}
									href="/liquidity"
									size="lg"
									variant="outline"
									color="purple.9"
									leftSection={<IconDroplet size={20} stroke={1.6} />}
								>
									Explore pools
								</Button>
							</Group>
						</Stack>
					</CardLayout>
				</BoxLayout>
			</Container>
		</AppLayout>
	);
};
