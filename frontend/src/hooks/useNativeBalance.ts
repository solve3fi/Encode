import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useAnchor } from "@/providers/DappProvider";

export const useNativeBalance = () => {
	const { connection, publicKey } = useAnchor();
	return useQuery({
		queryKey: ["balance", publicKey?.toBase58()],
		queryFn: async () => {
			return await connection.getBalance(publicKey);
		},
		select(data) {
			return data / LAMPORTS_PER_SOL;
		},
	});
};
