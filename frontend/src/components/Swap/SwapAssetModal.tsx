import { useLingui } from "@lingui/react";
import { isGenesisRestrictedTokenMint } from "@/configs/genesis";
import { COMMON_BASES } from "@/configs/tokens";
import { useAllTokens } from "@/hooks/useToken";
import { useCluster } from "@/providers/ClusterProvider";
import { useModal } from "@/stores/modal/ModalProvider";
import { useSwapActions } from "@/stores/swap/SwapProvider";
import { TokenAssetModal } from "../Modal/TokenAssetModal";

export const SwapAssetModal: React.FC = () => {
	const { i18n } = useLingui();
	const { setFrom, setTo } = useSwapActions();
	const { network } = useCluster();

	const defaultTokens = useAllTokens();
	const data = useModal((state) => state.data);

	return (
		<TokenAssetModal
			title={i18n._("Select a token")}
			selectToken={(token) => (data === "from" ? setFrom(token) : setTo(token))}
			tokenLists={defaultTokens}
			search
			pinTokens={COMMON_BASES[network]}
			isTokenAllowed={(token) => !isGenesisRestrictedTokenMint(token.address)}
		/>
	);
};
