import type React from "react";
import type { PropsWithChildren } from "react";
import { ApplicationProvider } from "./application/ApplicationProvider";
import { ModalProvider } from "./modal/ModalProvider";

export const StoreProvider: React.FC<PropsWithChildren> = ({ children }) => {
	return (
		<ApplicationProvider>
			<ModalProvider>{children}</ModalProvider>
		</ApplicationProvider>
	);
};
