import { type I18n, setupI18n } from "@lingui/core";
import { getI18n, setI18n } from "@lingui/react/server";
import type { SupportedLocale } from "./i18n-config";
import { i18n } from "./i18n-config";

export const getDictionary = async (locale: SupportedLocale): Promise<I18n> => {
	const cacheI18n = getI18n();
	if (!cacheI18n?.i18n) {
		const lang = i18n.locales.includes(locale) ? locale : i18n.defaultLocale;
		const { messages } = await import(`../locales/${lang}.json`);
		const i18nInstance = setupI18n({
			locale: lang,
			messages: { [lang]: messages },
		});
		i18nInstance.activate(lang);
		setI18n(i18nInstance);

		return i18nInstance;
	}
	return cacheI18n.i18n;
};
