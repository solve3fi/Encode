"use client";

import { Stack } from "@mantine/core";
import { PRESALE_TOKEN_SYMBOL } from "@/configs/presale";
import { useProtocolAdmin } from "@/hooks/useProtocolAdmin";
import { ClaimShell, GradText } from "../Layout/ClaimShell";
import { PresaleClaimPanel } from "./PresaleClaimPanel";
import { PresaleUploadPanel } from "./PresaleUploadPanel";

export const PresaleClaim: React.FC = () => {
	const { isAdmin } = useProtocolAdmin();

	return (
		<ClaimShell
			title={
				<>
					Claim your presale <GradText>allocation</GradText>
				</>
			}
			lede={`Connect the same Solana wallet that sent your presale payment. Claiming transfers and permanently locks your ${PRESALE_TOKEN_SYMBOL} into a veSOLV3 position in a single transaction — it's never held liquid.`}
		>
			<Stack gap="lg">
				{isAdmin && <PresaleUploadPanel />}
				<PresaleClaimPanel />
				{/* Presale round 2 has its own claim (shown only to wallets that bought in round 2). */}
				<PresaleClaimPanel round={2} />
			</Stack>
		</ClaimShell>
	);
};
