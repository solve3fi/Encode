"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WaveBackground.module.css";

const fragmentShader = `
precision mediump float;
uniform float time;
uniform float aspect;
varying vec2 vUv;
void main() {
	vec2 uv = vUv;
	float x = (uv.x - 0.5) * max(1.0, aspect * 0.65);
	float glow = 0.0;
	float threads = 0.0;
	for (int band = 0; band < 3; band++) {
		float b = float(band);
		float phase = x * 3.0 + time * 0.12 + b * 2.3;
		float center = 0.40 + sin(phase) * (0.13 + b * 0.025)
			+ cos(x * 1.7 - time * 0.07 + b) * 0.045 + b * 0.07;
		float width = 0.025 + 0.012 * (1.0 + sin(x * 2.0 + b));
		float distance = abs(uv.y - center);
		glow += exp(-distance * distance / (width * width)) * 0.22;
		for (int strand = 0; strand < 9; strand++) {
			float s = float(strand) - 4.0;
			float curve = center + s * 0.004 * (1.0 + sin(phase + 0.8) * 0.55);
			threads += exp(-abs(uv.y - curve) * 1900.0) * 0.23;
		}
	}
	float edge = smoothstep(0.0, 0.15, uv.y) * (1.0 - smoothstep(0.80, 1.0, uv.y));
	float strength = min(0.65, glow + threads) * edge;
	vec3 violet = mix(vec3(0.30, 0.15, 0.64), vec3(0.59, 0.41, 0.97), min(1.0, threads));
	gl_FragColor = vec4(violet, strength);
}
`;

export function WaveBackground() {
	const host = useRef<HTMLDivElement>(null);
	const [reduced, setReduced] = useState(true);

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduced(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		const element = host.current;
		if (!element) return;
		element.dataset.waveState = reduced ? "static" : "loading";
		if (reduced) return;
		let disposed = false;
		let release = () => {};
		// Load WebGL only when animation is allowed. The SVG stays available.
		void import("three")
			.then((THREE) => {
				if (disposed) return;
				let renderer: InstanceType<typeof THREE.WebGLRenderer>;
				try {
					renderer = new THREE.WebGLRenderer({
						alpha: true,
						antialias: false,
						powerPreference: "low-power",
					});
				} catch {
					element.dataset.waveState = "fallback";
					return;
				}
				renderer.setPixelRatio(
					Math.min(
						window.devicePixelRatio || 1,
						window.innerWidth < 640 ? 1 : 1.25,
					),
				);
				renderer.setClearColor(0x000000, 0);
				renderer.domElement.setAttribute("aria-hidden", "true");
				element.appendChild(renderer.domElement);
				element.dataset.waveState = "webgl";
				const scene = new THREE.Scene();
				const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
				const geometry = new THREE.PlaneGeometry(2, 2);
				const material = new THREE.ShaderMaterial({
					transparent: true,
					depthTest: false,
					depthWrite: false,
					uniforms: { time: { value: 0 }, aspect: { value: 1 } },
					vertexShader:
						"varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
					fragmentShader,
				});
				scene.add(new THREE.Mesh(geometry, material));
				let frame = 0;
				let visible = true;
				let lost = false;
				let last = 0;
				let elapsed = 0;
				const resize = () => {
					const width = element.clientWidth;
					const height = element.clientHeight;
					if (!width || !height) return;
					renderer.setSize(width, height, false);
					material.uniforms.aspect.value = width / height;
				};
				const draw = (now: number) => {
					if (disposed || lost || !visible || document.hidden) return;
					frame = requestAnimationFrame(draw);
					if (now - last < 1000 / 30) return;
					elapsed += Math.min((now - (last || now)) / 1000, 0.1);
					last = now;
					material.uniforms.time.value = elapsed;
					renderer.render(scene, camera);
				};
				const schedule = () => {
					cancelAnimationFrame(frame);
					last = 0;
					if (!disposed && !lost && visible && !document.hidden)
						frame = requestAnimationFrame(draw);
				};
				const onLoss = () => {
					lost = true;
					element.dataset.waveState = "fallback";
					renderer.domElement.style.display = "none";
					cancelAnimationFrame(frame);
				};
				renderer.domElement.addEventListener("webglcontextlost", onLoss);
				document.addEventListener("visibilitychange", schedule);
				const observer = new IntersectionObserver(([entry]) => {
					visible = entry.isIntersecting;
					schedule();
				});
				observer.observe(element);
				const sizes = new ResizeObserver(resize);
				sizes.observe(element);
				resize();
				schedule();
				release = () => {
					cancelAnimationFrame(frame);
					observer.disconnect();
					sizes.disconnect();
					document.removeEventListener("visibilitychange", schedule);
					renderer.domElement.removeEventListener("webglcontextlost", onLoss);
					geometry.dispose();
					material.dispose();
					renderer.dispose();
					renderer.domElement.remove();
				};
			})
			.catch(() => {
				if (!disposed) element.dataset.waveState = "fallback";
			});
		return () => {
			disposed = true;
			release();
		};
	}, [reduced]);

	return (
		<div ref={host} data-wave-background="" className={styles.root} aria-hidden="true">
			<svg
				viewBox="0 0 1400 800"
				preserveAspectRatio="none"
				className={styles.still}
			>
				<path d="M-100 470 C260 190 380 180 690 390 S1150 590 1500 260" />
				<path d="M-100 560 C260 700 510 610 790 420 S1190 260 1500 450" />
				<path d="M-100 620 C400 410 650 350 920 520 S1300 600 1500 400" />
			</svg>
		</div>
	);
}
