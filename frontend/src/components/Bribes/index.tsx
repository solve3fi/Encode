"use client";

import { useLingui } from "@lingui/react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SOL, SOLVE } from "@/configs/tokens";
import { getBribeTokenPDA, useVesolveProgram } from "@/hooks/useVesolveProgram";
import { useAllTokens } from "@/hooks/useToken";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useCreateBribe } from "@/stores/vote/hooks/useCreateBribe";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { TokenAssetModal } from "../Modal/TokenAssetModal";
import { BribesAssetAmount } from "./BribesAssetAmount";
import { BribesPool } from "./BribesPool";
import classes from "./Bribes.module.css";
import { FundNudge } from "@/components/Fund/FundNudge";

export const Bribes: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { setOpenModal } = useModalActions();

	const { data: voteConfig } = useVoteConfig(network);
	const [poolAddress, setPoolAddress] = useState<string>();
	const [tokenAddress, setTokenAddress] = useState<string>(SOLVE.address);
	const [amountIn, setAmountIn] = useState<number>(0);
	const allTokens = useAllTokens();
	// create_bribe expects the depositor to already hold the incentive token
	// in a plain SPL token account -- picking native SOL here always fails
	// with AccountNotInitialized, since nobody holds a wrapped-SOL ATA by
	// default and nothing here wraps it first. Hide it rather than silently
	// failing every time; wrapped tokens (SOLV3, devUSDC, ...) work fine.
	// Native SOL is offered only when the program has approved wrapped SOL as an incentive token; the transaction wraps it.
	const vesolveProgram = useVesolveProgram();
	const { data: solApproved } = useQuery({
		queryKey: ["bribe-token-approved", SOL.address],
		queryFn: async () =>
			Boolean(await vesolveProgram.provider.connection.getAccountInfo(getBribeTokenPDA(new PublicKey(SOL.address))[0])),
		staleTime: 60_000,
	});
	const tokenLists = useMemo(() => {
		if (solApproved) return allTokens;
		const { [SOL.address]: _sol, ...rest } = allTokens;
		return rest;
	}, [allTokens, solApproved]);
	const token = tokenLists[tokenAddress] ?? SOLVE;

	const { publicKey } = useWallet();
	const { mutate, isPending } = useCreateBribe();

	const handleCreateBribes = useCallback(() => {
		if (!poolAddress || !voteConfig?.epoch || !publicKey) return;
		mutate({
			amount: new BN(amountIn * 10 ** token.decimals),
			authority: publicKey,
			pool: new PublicKey(poolAddress),
			mintToken: new PublicKey(token.address),
			epoch: voteConfig.epoch.toNumber(),
		});
	}, [
		amountIn,
		publicKey,
		mutate,
		poolAddress,
		token.address,
		token.decimals,
		voteConfig?.epoch,
	]);

	return (
		<div className={classes.page}>
			<Link href="/arena" className={classes.back}>
				← {i18n._("Back to Vote")}
			</Link>
			<header className={classes.head}>
				<h1>
					{i18n._("Add")} <span className={classes.grad}>{i18n._("bribe")}</span>
				</h1>
				<p>
					{i18n._(
						"Offer voting incentives for a pool. Your deposit funds that pool's gauge for the current epoch and is shared among its eligible voters according to their share of voting power. Incentives can attract votes that direct weekly SOLV3 emissions to the pool's liquidity providers.",
					)}
				</p>
			</header>
			<FundNudge asset="choose" title="Fund your incentive from any chain" text="Pay from another chain and receive USDC or SOL in your wallet, then add it as an incentive here. Native SOL is wrapped for you once SOL is an approved incentive token; until then, swap it into an approved token first." />

			<section className={classes.panel}>
				<ul className={classes.instructions}>
					<li>{i18n._("Choose the pool, select your incentive token, and enter the amount to deposit.")}</li>
					<li>{i18n._("Check the token, amount, network and epoch before approving the transaction in your wallet.")}</li>
					<li>
						{i18n._("Deposited incentives join trading fees funded to the same gauge. The")}{" "}
						<Link href="/arena">{i18n._("Arena")}</Link>{" "}
						{i18n._("shows the reward breakdown; liquidity emissions are displayed separately.")}
					</li>
				</ul>
			</section>

			<section className={classes.panel}>
				<div className={classes.step}>
					<span className={classes.num}>1</span>
					<div className={classes.stepBody}>
						<BribesPool onSelected={setPoolAddress} />
					</div>
				</div>
				<div className={classes.step}>
					<span className={classes.num}>2</span>
					<div className={classes.stepBody}>
						<span className={classes.label}>{i18n._("Incentive token and amount")}</span>
						<BribesAssetAmount
							onSetAmount={setAmountIn}
							amountIn={amountIn}
							token={token}
						/>
					</div>
				</div>
				{publicKey ? (
					<button
						type="button"
						className={classes.primary}
						disabled={isPending || !poolAddress || amountIn <= 0}
						onClick={handleCreateBribes}
					>
						{isPending ? i18n._("Confirm in wallet…") : i18n._("Add bribe")}
					</button>
				) : (
					<button
						type="button"
						className={classes.primary}
						onClick={() => setOpenModal(ModalType.WALLET)}
					>
						{i18n._("Connect wallet")}
					</button>
				)}
			</section>

			<section className={classes.warn} role="note">
				<span className={classes.label}>{i18n._("Before you deposit")}</span>
				<p>
					{i18n._(
						"Incentives do not guarantee votes, liquidity, emissions, or a return. Do not assume deposits can be cancelled or refunded. Claim availability follows the deployed epoch rules.",
					)}
					{network === ClusterNetwork.Devnet && ` ${i18n._("Devnet tokens have no monetary value.")}`}
				</p>
			</section>

			<TokenAssetModal
				title={i18n._("Select Token")}
				selectToken={(address) => setTokenAddress(address.toString())}
				tokenLists={tokenLists}
			/>
		</div>
	);
};
