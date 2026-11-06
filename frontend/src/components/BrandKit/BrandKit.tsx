import {
	IconArrowDown,
	IconArrowUpRight,
	IconFileTypePdf,
	IconPackage,
} from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import styles from "./BrandKit.module.css";

type Download = {
	label: string;
	href: string;
	meta: string;
};

type Mark = {
	title: string;
	description: string;
	preview: string;
	previewClassName?: string;
	downloads: Download[];
};

const marks: Mark[] = [
	{
		title: "Primary lockup",
		description: "The default Solve3 signature for dark backgrounds.",
		preview: "/brand-kit/logos/lockup-primary.svg",
		downloads: [
			{
				label: "SVG",
				href: "/brand-kit/logos/lockup-primary.svg",
				meta: "Vector",
			},
			{
				label: "PNG",
				href: "/brand-kit/logos/lockup-primary.png",
				meta: "Transparent",
			},
		],
	},
	{
		title: "Symbol",
		description: "Use when the Solve3 name is already clear from context.",
		preview: "/brand-kit/logos/symbol-gradient.svg",
		previewClassName: styles.symbolPreview,
		downloads: [
			{
				label: "SVG",
				href: "/brand-kit/logos/symbol-gradient.svg",
				meta: "Vector",
			},
			{
				label: "PNG",
				href: "/brand-kit/logos/symbol-gradient.png",
				meta: "Transparent",
			},
		],
	},
	{
		title: "Monochrome lockups",
		description: "Single-color alternatives for light and dark surfaces.",
		preview: "/brand-kit/logos/lockup-white.svg",
		downloads: [
			{
				label: "White SVG",
				href: "/brand-kit/logos/lockup-white.svg",
				meta: "Dark surfaces",
			},
			{
				label: "Dark SVG",
				href: "/brand-kit/logos/lockup-dark.svg",
				meta: "Light surfaces",
			},
		],
	},
];

const colors = [
	{ name: "Void", value: "#070711", className: styles.void },
	{ name: "SOLV3 violet", value: "#685DF7", className: styles.violet },
	{ name: "Signal cyan", value: "#58D7FF", className: styles.cyan },
	{ name: "Primary text", value: "#F6F5F9", className: styles.light },
];

const DownloadLink = ({
	download,
	markTitle,
}: {
	download: Download;
	markTitle: string;
}) => (
	<a
		className={styles.downloadLink}
		href={download.href}
		download
		aria-label={`Download ${markTitle} as ${download.label}`}
	>
		<span className={styles.downloadMeta}>
			<small>{download.meta}</small>
			<strong>{download.label}</strong>
		</span>
		<IconArrowDown size={18} stroke={1.8} aria-hidden="true" />
	</a>
);

export const BrandKit = () => (
	<div className={styles.page}>
		<section className={styles.hero}>
			<div className={styles.heroCopy}>
				<span className={styles.eyebrow}>Solve3 / Brand kit</span>
				<h1>
					The system behind
					<span className={styles.heroTitleMuted}>the signal.</span>
				</h1>
				<p>
					Use these files to represent Solve3 clearly and consistently. The kit
					includes the original marks, color and type guidance, social formats,
					partnership templates, and ready-to-use exports.
				</p>
				<div className={styles.heroActions}>
					<a
						className={styles.primaryAction}
						href="/brand-kit/Solve3-Brand-Kit.zip"
						download
					>
						<IconPackage size={19} stroke={1.8} aria-hidden="true" />
						Download full kit
					</a>
					<a
						className={styles.secondaryAction}
						href="/brand-kit/Solve3-Brand-Guide.pdf"
						download
					>
						<IconFileTypePdf size={19} stroke={1.8} aria-hidden="true" />
						Download guide
					</a>
				</div>
				<p className={styles.fileNote}>
					ZIP · 5.2 MB · SVG, PNG, PDF, fonts, tokens, and templates
				</p>
			</div>

			<div className={styles.heroMark} aria-hidden="true">
				<Image
					src="/brand-kit/logos/symbol-gradient.svg"
					alt=""
					width={520}
					height={520}
					priority
				/>
				<span className={styles.orbitOne} />
				<span className={styles.orbitTwo} />
			</div>
		</section>

		<section className={styles.section} aria-labelledby="marks-heading">
			<div className={styles.sectionIntro}>
				<span className={styles.sectionLabel}>Core marks</span>
				<div>
					<h2 id="marks-heading">Start with the original.</h2>
					<p>
						Keep the artwork intact. Give it room, preserve its proportions, and
						choose the version with the clearest contrast.
					</p>
				</div>
			</div>

			<div className={styles.markGrid}>
				{marks.map((mark) => (
					<article className={styles.markCard} key={mark.title}>
						<div className={styles.markPreview}>
							<Image
								src={mark.preview}
								alt={`${mark.title} preview`}
								width={430}
								height={160}
								className={mark.previewClassName}
							/>
						</div>
						<div className={styles.markBody}>
							<h3>{mark.title}</h3>
							<p>{mark.description}</p>
							<div className={styles.downloads}>
								{mark.downloads.map((download) => (
									<DownloadLink
										download={download}
										markTitle={mark.title}
										key={download.href}
									/>
								))}
							</div>
						</div>
					</article>
				))}
			</div>
		</section>

		<section
			className={`${styles.section} ${styles.foundation}`}
			aria-labelledby="foundation-heading"
		>
			<div className={styles.sectionIntro}>
				<span className={styles.sectionLabel}>Foundation</span>
				<div>
					<h2 id="foundation-heading">A dark field. A precise signal.</h2>
					<p>
						The palette stays restrained so liquidity, voting, rewards, and
						status information remain legible.
					</p>
				</div>
			</div>

			<div className={styles.foundationGrid}>
				<ul className={styles.palette} aria-label="Solve3 core colors">
					{colors.map((color) => (
						<li className={styles.swatch} key={color.value}>
							<span className={`${styles.swatchColor} ${color.className}`} />
							<strong>{color.name}</strong>
							<code>{color.value}</code>
						</li>
					))}
				</ul>

				<div className={styles.typeSpecimen}>
					<span className={styles.typeLabel}>Primary typeface</span>
					<p className={styles.typeSample}>Be Vietnam Pro</p>
					<p className={styles.typeAlphabet}>Aa Bb Cc 0123</p>
					<p>
						Clear at interface scale. Calm at campaign scale. Included in the
						full kit under the SIL Open Font License.
					</p>
				</div>
			</div>
		</section>

		<section
			className={`${styles.section} ${styles.guideSection}`}
			aria-labelledby="guide-heading"
		>
			<div className={styles.guideCard}>
				<div>
					<span className={styles.sectionLabel}>Usage guide</span>
					<h2 id="guide-heading">Keep every touchpoint recognizably Solve3.</h2>
					<p>
						The guide covers logo usage, typography, voice, messaging, interface
						direction, social graphics, community assets, and partnership
						layouts.
					</p>
					<div className={styles.guideActions}>
						<a
							href="/brand-kit/Solve3-Brand-Guide.pdf"
							target="_blank"
							rel="noopener noreferrer"
						>
							Open brand guide{" "}
							<IconArrowUpRight size={17} stroke={1.8} aria-hidden="true" />
						</a>
						<a
							href="/brand-kit/Solve3-Quick-Reference.pdf"
							target="_blank"
							rel="noopener noreferrer"
						>
							Quick reference{" "}
							<IconArrowUpRight size={17} stroke={1.8} aria-hidden="true" />
						</a>
					</div>
				</div>
				<div className={styles.guidePreview}>
					<Image
						src="/brand-kit/Solve3-Quick-Reference.png"
						alt="Solve3 brand quick-reference sheet preview"
						width={640}
						height={427}
					/>
				</div>
			</div>
		</section>

		<section className={styles.contact}>
			<span>Need another format or approval?</span>
			<Link href="mailto:admin@solve3.fi">
				Contact Solve3{" "}
				<IconArrowUpRight size={17} stroke={1.8} aria-hidden="true" />
			</Link>
		</section>
	</div>
);
