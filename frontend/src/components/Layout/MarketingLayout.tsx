import type { PropsWithChildren } from "react";
import { Footer } from "@/components/Footer";
import { Header, type MarketingCta } from "@/components/Header";

export const MarketingLayout = ({
	children,
	cta,
}: PropsWithChildren<{ cta?: MarketingCta }>) => (
	<div style={{ minHeight: "100vh", background: "var(--surface-base)", color: "var(--text-primary)" }}>
		<Header variant="marketing" cta={cta} />
		<main>{children}</main>
		<Footer variant="marketing" />
	</div>
);
