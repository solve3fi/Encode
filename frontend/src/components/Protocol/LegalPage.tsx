import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import Link from "next/link";
import { disclosures, privacy, terms } from "./legalContent";
import styles from "./LegalPage.module.css";

export const LegalPage = ({ title }: { title: string }) => (
	<div className={styles.page}>
		<Header variant="marketing" />
		<main className={styles.main}>
			<p className={styles.label}>Solve3 legal</p>
			<h1>{title}</h1>
			<div className={styles.notice}>
				<p>Solve3 Labs · USA · Updated September 10, 2026</p>
				<p>Devnet testing only. Test tokens have no monetary value. These documents describe the current testing service and require legal review before a mainnet launch.</p>
				<p>Contact: <a href="mailto:admin@solve3.fi">admin@solve3.fi</a></p>
			</div>
			<nav className={styles.navigation} aria-label="Legal documents">
				<Link href="/legal">Legal disclosures</Link><Link href="/term">Terms of service</Link><Link href="/privacy">Privacy policy</Link><Link href="/risk">Risk and admin roles</Link>
			</nav>
			{(title === "Privacy policy" ? privacy : title === "Terms of service" ? terms : disclosures).map((section) => (
				<section className={styles.section} key={section.heading}>
					<h2>{section.heading}</h2>
					{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
				</section>
			))}
		</main>
		<Footer variant="marketing" />
	</div>
);
