import { useWallet } from "@solana/wallet-adapter-react";
import { ConnectButton } from "./ConnectButton";
import { ConnectedButton } from "./ConnectedButton";

export const WalletConnect: React.FC = () => {
	const { publicKey } = useWallet();
	return publicKey ? <ConnectedButton /> : <ConnectButton />;
};
