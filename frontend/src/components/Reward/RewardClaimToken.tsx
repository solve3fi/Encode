import { useLingui } from "@lingui/react";
import { Button } from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useClaimAllRewards } from "@/hooks/useClaimAllRewards";

// Claims everything regardless of which Rewards tab (Liquidity/Voting) is
// active -- see useClaimAllRewards for why this is the union of both.
export const RewardClaimToken: React.FC = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const { mutate: claimAll, isPending } = useClaimAllRewards();
	// The command bar sends people here with ?focus=claim-all; the click itself stays theirs.
	const focused = useSearchParams().get("focus") === "claim-all";
	const buttonRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!focused) return;
		buttonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
		buttonRef.current?.focus({ preventScroll: true });
	}, [focused]);

	return (
		<Button
			ref={buttonRef}
			style={
				focused
					? { boxShadow: "0 0 0 3px rgba(140, 132, 255, 0.55)" }
					: undefined
			}
			size="lg"
			radius={12}
			h={52}
			fullWidth
			disabled={!publicKey}
			loading={isPending}
			onClick={() => claimAll()}
		>
			{i18n._("Claim All Rewards")}
		</Button>
	);
};
