"use client";

import { Alert, Stack } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useProtocolAdmin } from "@/hooks/useProtocolAdmin";
import { AIRDROP_TOKEN_SYMBOL } from "@/configs/airdrop";
import { ClaimShell, GradText } from "../Layout/ClaimShell";
import { AirdropClaimPanel } from "./AirdropClaimPanel";
import { AirdropUploadPanel } from "./AirdropUploadPanel";

export const AirdropClaim: React.FC = () => {
	const { isAdmin } = useProtocolAdmin();

	return (
		<ClaimShell
			title={
				<>
					Claim your <GradText>airdrop</GradText>
				</>
			}
			lede={`Connect your Ethereum wallet to check your ${AIRDROP_TOKEN_SYMBOL} allocation, then connect the Solana wallet that will receive it. Claiming transfers and permanently locks the SOLV3 into a veSOLV3 position in a single transaction — it's never held liquid.`}
		>
			<Stack gap="lg">
				<Alert
					color="yellow"
					icon={<IconInfoCircle size={18} />}
					title="Devnet sandbox test only"
				>
					This page is for airdrop claims in the Sandbox on devnet. It is{" "}
					<strong>not</strong> the mainnet airdrop, which will come later.
					Tokens claimed here are test tokens with no monetary value.
				</Alert>
				{isAdmin && <AirdropUploadPanel />}
				<AirdropClaimPanel />
			</Stack>
		</ClaimShell>
	);
};
