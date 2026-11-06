"use client";

import { useLingui } from "@lingui/react";
import {
	Avatar,
	Button,
	Center,
	FileInput,
	Group,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import { tokenRequestAuthMessage } from "@/configs/tokenRequests";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./TokenRequestForm.module.css";

export const TokenRequestForm: React.FC = () => {
	const { i18n } = useLingui();
	const router = useRouter();
	const { publicKey, signMessage } = useWallet();
	const { setOpenModal } = useModalActions();

	const params = useSearchParams();
	const [mint, setMint] = useState(params.get("mint") ?? "");
	const [symbol, setSymbol] = useState(params.get("symbol") ?? "");
	const [name, setName] = useState(params.get("name") ?? "");
	const [website, setWebsite] = useState(params.get("website") ?? "");
	const [twitter, setTwitter] = useState(params.get("twitter") ?? "");
	const [logo, setLogo] = useState<File | null>(null);

	const logoPreviewUrl = useMemo(
		() => (logo ? URL.createObjectURL(logo) : null),
		[logo],
	);

	const submit = useMutation({
		mutationFn: async () => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			if (!signMessage) {
				throw new Error(i18n._("This wallet doesn't support message signing"));
			}
			let mintAddress: PublicKey;
			try {
				mintAddress = new PublicKey(mint.trim());
			} catch {
				throw new Error(i18n._("Enter a valid token mint address"));
			}
			if (!symbol.trim() || !name.trim()) {
				throw new Error(i18n._("Symbol and name are required"));
			}
			if (!logo) {
				throw new Error(i18n._("A logo image is required"));
			}

			const message = tokenRequestAuthMessage(mintAddress.toString());
			const signatureBytes = await signMessage(new TextEncoder().encode(message));
			const signature = Buffer.from(signatureBytes).toString("base64");

			const form = new FormData();
			form.set("mint", mintAddress.toString());
			form.set("symbol", symbol.trim());
			form.set("name", name.trim());
			if (website.trim()) form.set("website", website.trim());
			if (twitter.trim()) form.set("twitter", twitter.trim());
			form.set("wallet", publicKey.toString());
			form.set("message", message);
			form.set("signature", signature);
			form.set("logo", logo);

			const res = await fetch("/api/token-requests", { method: "POST", body: form });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? i18n._("Submission failed"));
			return data;
		},
		onSuccess: () => {
			notification.success({
				title: i18n._("Token Listing Request"),
				message: i18n._("Submitted — an admin will review it shortly."),
			});
			router.push("/liquidity");
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Token Listing Request"), message: error.message });
		},
	});

	return (
		<div className={classes.page}>
			<Link href="/liquidity/create" className={classes.back}>
				← {i18n._("Back to Add liquidity")}
			</Link>
			<header className={classes.head}>
				<h1>
					{i18n._("Request")} <span className={classes.grad}>{i18n._("token listing")}</span>
				</h1>
				<p>
					{i18n._("Don't have a pool yet?")}{" "}
					<Link href="/liquidity/create">{i18n._("Create one first")}</Link>
					{", "}
					{i18n._("then come back and request your token show up branded across the app.")}
				</p>
			</header>
			<Stack gap="md" className={classes.panel}>

				<TextInput
					label={i18n._("Token mint address")}
					placeholder="So1111...1112"
					value={mint}
					onChange={(event) => setMint(event.currentTarget.value)}
					required
				/>
				<Group grow>
					<TextInput
						label={i18n._("Symbol")}
						placeholder="WIF3"
						value={symbol}
						onChange={(event) => setSymbol(event.currentTarget.value)}
						required
					/>
					<TextInput
						label={i18n._("Name")}
						placeholder="dogwifhat"
						value={name}
						onChange={(event) => setName(event.currentTarget.value)}
						required
					/>
				</Group>
				<TextInput
					label={i18n._("Website")}
					placeholder="https://"
					value={website}
					onChange={(event) => setWebsite(event.currentTarget.value)}
				/>
				<TextInput
					label={i18n._("X (Twitter)")}
					placeholder="https://x.com/…"
					value={twitter}
					onChange={(event) => setTwitter(event.currentTarget.value)}
				/>
				<Group align="flex-end" gap="md">
					<FileInput
						label={i18n._("Logo")}
						placeholder={i18n._("PNG, JPG, WEBP, or SVG — under 512KB")}
						accept="image/png,image/jpeg,image/webp,image/svg+xml"
						value={logo}
						onChange={setLogo}
						flex={1}
						required
					/>
					{logoPreviewUrl && <Avatar src={logoPreviewUrl} size={48} radius="md" />}
				</Group>

				<Button
					size="lg"
					radius={14}
					h={56}
					loading={submit.isPending}
					onClick={() => (publicKey ? submit.mutate() : setOpenModal(ModalType.WALLET))}
				>
					{publicKey ? i18n._("Submit for review") : i18n._("Connect wallet")}
				</Button>
				{!publicKey && (
					<Center>
						<Text c="gray" fz="xs">
							{i18n._("Connect a wallet to sign and submit your request.")}
						</Text>
					</Center>
				)}
			</Stack>
		</div>
	);
};
