import { Center, Loader } from "@mantine/core";
import type { Address } from "@solve3fi/common";
import { usePoolInfo } from "@/hooks/usePoolInfo";
import { usePositionInfo } from "@/hooks/usePositionInfo";
import { ManagerData } from "./ManagerData";
import { NotFound } from "./NotFound";

export type ManagerProps = {
	positionId: Address;
};

export const ManagerWrapper: React.FC<ManagerProps> = ({ positionId }) => {
	const { data: position, isLoading: isLoadingPosition } =
		usePositionInfo(positionId);
	const { data: pool, isLoading: isLoadingPool } = usePoolInfo(
		position?.getData().solve.toString() || "",
	);

	if (isLoadingPosition || isLoadingPool) {
		return (
			<Center>
				<Loader />
			</Center>
		);
	}

	return position && pool ? (
		<ManagerData position={position} pool={pool} />
	) : (
		<NotFound />
	);
};
