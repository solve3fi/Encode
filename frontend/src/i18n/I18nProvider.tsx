"use client";

import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider as LinguiI18nProvider } from "@lingui/react";
import { type PropsWithChildren, useState } from "react";
import type { SupportedLocale } from "./i18n-config";

export type I18nProviderProps = {
	initialLocale: SupportedLocale;
	initialMessages: Messages;
};

export const I18nProvider: React.FC<PropsWithChildren<I18nProviderProps>> = ({
	initialLocale,
	initialMessages,
	children,
}) => {
	const [i18n] = useState(() =>
		setupI18n({
			locale: initialLocale,
			messages: { [initialLocale]: initialMessages },
		}),
	);
	return <LinguiI18nProvider i18n={i18n}>{children}</LinguiI18nProvider>;
};
