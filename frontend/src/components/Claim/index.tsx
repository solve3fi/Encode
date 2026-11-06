"use client";

import { CardLayout } from "../Layout/CardLayout";
import { CLaimList } from "./ClaimList";

export const Claim: React.FC = () => {
	return (
		<CardLayout>
			<CLaimList />
		</CardLayout>
	);
};
