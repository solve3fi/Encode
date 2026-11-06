import "@mantine/carousel/styles.css";
import "@mantine/core/styles.layer.css";
import "mantine-datatable/styles.layer.css";
import "./style.css";

import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";

import { ConnectModal } from "@/components/Modal/ConnectModal";
import { SlippageModal } from "@/components/Modal/SlippageModal";
import { getDictionary } from "@/i18n/helper";
import { i18n as i18nConfig, type SupportedLocale } from "@/i18n/i18n-config";
import { Providers } from "@/providers";
import { bevn, funnel } from "@/theme/fonts";
import { createPageMetadata } from "@/lib/metadata";

export const dynamicParams = false;

export function generateStaticParams() {
	return i18nConfig.locales.map((locale) => ({ locale }));
}

export const metadata = createPageMetadata(
	"Protocol",
	"Permanent SOLV3 locks direct weekly emissions across Solana liquidity pools.",
	"/",
);

export default async function RootLayout({
	children,
	params,
}: Readonly<{
	children: React.ReactNode;
	params: Promise<{ locale: SupportedLocale }>;
}>) {
	const locale = (await params).locale;
	const dictionary = await getDictionary(locale);

	return (
		<html
			lang={locale}
			style={{
				scrollBehavior: "smooth",
				WebkitFontSmoothing: "antialiased",
				MozOsxFontSmoothing: "grayscale",
				textRendering: "optimizeLegibility",
			}}
			{...mantineHtmlProps}
		>
			<head>
				<ColorSchemeScript />
				<link rel="shortcut icon" href="/favicon.ico" />
				<meta
					name="viewport"
					content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
				/>
			</head>
			<body className={`${bevn.className} ${bevn.variable} ${funnel.variable}`} suppressHydrationWarning={true}>
				<Providers
					locale={locale}
					messages={JSON.parse(JSON.stringify(dictionary.messages))}
				>
					{children}

					<SlippageModal />
					<ConnectModal />
				</Providers>
			</body>
		</html>
	);
}
