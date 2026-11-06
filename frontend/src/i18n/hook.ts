import Cookies from "js-cookie";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentLocale } from "next-i18n-router/client";
import { i18n } from "./i18n-config";

export const useLocale = () => {
	const currentLocale = useCurrentLocale(i18n);
	const router = useRouter();
	const currentPathname = usePathname();

	const changeLanguage = (locale: string) => {
		const expired = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		Cookies.set("NEXT_LOCALE", locale, {
			expires: expired,
			path: "/",
		});

		if (currentLocale === i18n.defaultLocale && !i18n.prefixDefault) {
			router.push(`/${locale}${currentPathname}`);
		} else {
			router.push(currentPathname.replace(`/${currentLocale}`, `/${locale}`));
		}
		router.refresh();
	};

	const path = currentLocale !== i18n.defaultLocale ? `/${currentLocale}` : "";

	return { path, changeLanguage, currentLocale };
};
