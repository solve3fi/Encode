"use client";

import { useSearchParams } from "next/navigation";
import { PoolProvider } from "@/stores/pool/PoolProvider";
import { PoolManagerProvider } from "@/stores/pool-manager/PoolManagaerProvider";
import { ManagerWrapper } from "./ManagerWrapper";
import { NotFound } from "./NotFound";

export const Manager: React.FC = () => {
	const searchParams = useSearchParams();
	const positionId = searchParams.get("positionId");

	return positionId ? (
		<PoolProvider>
			<PoolManagerProvider>
				<ManagerWrapper positionId={positionId} />
			</PoolManagerProvider>
		</PoolProvider>
	) : (
		<NotFound />
	);
};
