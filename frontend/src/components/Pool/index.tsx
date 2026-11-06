"use client";

import { PoolProvider } from "@/stores/pool/PoolProvider";
import { PoolWrapper } from "./PoolWrapper";

export const Pool: React.FC = () => {
	return (
		<PoolProvider>
			<PoolWrapper />
		</PoolProvider>
	);
};
