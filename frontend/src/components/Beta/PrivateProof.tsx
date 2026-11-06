"use client";

import p from "./Preview.module.css";

export type ProofLink = { label: string; href: string };
export type ProofShot = { src: string; alt: string; caption: string };

type Props = {
	product: string;
	/** One honest sentence about who can use it today. */
	who: string;
	built: ReadonlyArray<React.ReactNode>;
	running: ReadonlyArray<React.ReactNode>;
	tested: ReadonlyArray<React.ReactNode>;
	links?: ReadonlyArray<ProofLink>;
	shots: ReadonlyArray<ProofShot>;
	notYet: ReadonlyArray<React.ReactNode>;
	checked: string;
};

/**
 * "Real, running, private" evidence block. Every line must be a fact that was checked against the private repository, a
 * test run or Solana devnet, and the block always ends with what is not done. Nothing here is sample data.
 */
export const PrivateProof: React.FC<Props> = ({ product, who, built, running, tested, links = [], shots, notYet, checked }) => (
	<section aria-label={`${product}: built and running privately`} className={p.proof}>
		<div className={p.proofHead}>
			<span className={p.priv}>PRIVATE PREVIEW</span>
			<h2 style={{ margin: 0 }}>Built and running. Not open to the public.</h2>
		</div>
		<p style={{ margin: 0, color: "#C9C7D6", lineHeight: 1.6, maxWidth: 860 }}>{who}</p>

		<div className={p.cols}>
			<div className={p.col}>
				<h3>Built</h3>
				<ul>
					{built.map((b, i) => (
						<li key={i}>{b}</li>
					))}
				</ul>
			</div>
			<div className={p.col}>
				<h3>Running</h3>
				<ul>
					{running.map((b, i) => (
						<li key={i}>{b}</li>
					))}
				</ul>
			</div>
			<div className={p.col}>
				<h3>Tested</h3>
				<ul>
					{tested.map((b, i) => (
						<li key={i}>{b}</li>
					))}
				</ul>
			</div>
		</div>

		{links.length > 0 && (
			<div className={p.links}>
				<span style={{ fontSize: 13, color: "#A6A4B8" }}>Check it yourself on Solana devnet:</span>
				{links.map((l) => (
					<a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
						{l.label} ↗
					</a>
				))}
			</div>
		)}

		<div className={p.shots}>
			{shots.map((s) => (
				<figure key={s.src} className={p.shot}>
					{/* biome-ignore lint/performance/noImgElement: static screenshots of the real app */}
					<img src={s.src} alt={s.alt} loading="lazy" />
					<figcaption>{s.caption}</figcaption>
				</figure>
			))}
		</div>

		<div className={p.notyet}>
			<h3>What is not done yet</h3>
			<ul>
				{notYet.map((b, i) => (
					<li key={i}>{b}</li>
				))}
			</ul>
		</div>
		<p className={p.fine}>{checked}</p>
	</section>
);
