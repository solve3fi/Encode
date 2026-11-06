"use client";

import { type PropsWithChildren, Suspense } from "react";
import { Footer } from "@/components/Footer";
import { FooterNavbar } from "@/components/Footer/FooterNavbar";
import { WaveBackground } from "@/components/WaveBackground";
import { Header } from "@/components/Header";
import { DevnetBanner } from "@/components/ProtocolStatus/DevnetBanner";
import classes from "./AppLayout.module.css";
import { ProtocolContext } from "./ProtocolContext";

export const LegacyAppLayout: React.FC<PropsWithChildren> = ({ children }) => (
	<div className={classes.shell}>
		<WaveBackground />
		<Header />
		<DevnetBanner />
		<ProtocolContext />
		<main className={classes.main}>
			<Suspense fallback={null}>{children}</Suspense>
		</main>
		<Footer />
		<FooterNavbar />
	</div>
);
