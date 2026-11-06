import { useLingui } from "@lingui/react";
import { isGenesisRestrictedTokenMint } from "@/configs/genesis";
import { COMMON_BASES } from "@/configs/tokens";
import { useAllTokens } from "@/hooks/useToken";
import { useCluster } from "@/providers/ClusterProvider";
import { useModal } from "@/stores/modal/ModalProvider";
import { Field } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";
import { TokenAssetModal } from "../Modal/TokenAssetModal";

export type PoolTokenModalData = {
	method: Field;
};

export const PoolAssetModal: React.FC = () => {
	const data = useModal((state) => state.data) as PoolTokenModalData;
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { setCurrencyA, setCurrencyB } = usePoolActions();
	const defaultTokens = useAllTokens();

	return (
		<TokenAssetModal
			title={i18n._("Select Token")}
			selectToken={
				data && data.method === Field.CURRENCY_A ? setCurrencyA : setCurrencyB
			}
			search
			tokenLists={defaultTokens}
			pinTokens={COMMON_BASES[network]}
			isTokenAllowed={(token) => !isGenesisRestrictedTokenMint(token.address)}
		/>
	);
};
