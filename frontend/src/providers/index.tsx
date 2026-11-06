import type { Messages } from "@lingui/core";
import type { PropsWithChildren } from "react";
import { QuestSessionProvider } from "@/components/QuestTest/QuestSessionProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { SupportedLocale } from "@/i18n/i18n-config";
import { StoreProvider } from "@/stores/StoreProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ClusterProvider } from "./ClusterProvider";
import { DappProvider } from "./DappProvider";
import { EvmWalletProvider } from "./EvmWalletProvider";
import { QueryProvider } from "./QueryProvider";
import { WalletErrorBoundary } from "./WalletErrorBoundary";

export type ProvidersProps = PropsWithChildren<{
	locale: SupportedLocale;
	messages: Messages;
}>;

export const Providers: React.FC<ProvidersProps> = ({
	children,
	locale,
	messages,
}) => {
	return (
		<ThemeProvider>
			<I18nProvider initialLocale={locale} initialMessages={messages}>
				<ClusterProvider>
					<WalletErrorBoundary>
						<DappProvider>
							<QueryProvider>
								<EvmWalletProvider>
									<QuestSessionProvider>
										<StoreProvider>{children}</StoreProvider>
									</QuestSessionProvider>
								</EvmWalletProvider>
							</QueryProvider>
						</DappProvider>
					</WalletErrorBoundary>
				</ClusterProvider>
			</I18nProvider>
		</ThemeProvider>
	);
};
