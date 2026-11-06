import {
  demoPositions,
  money,
  price,
  short,
  units,
  parseSnapshot,
  snapshotPositions,
  validateStrategy,
} from "./model.js";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let snapshot = null,
  positions = demoPositions,
  paused = false,
  period = "1W",
  toastTimer;
const events = [
  {
    title: "Demo workspace opened",
    detail: "Illustrative balances and prices loaded. No wallet connected.",
    time: new Date(),
  },
];
const labels = {
  backtest: ["Test the range. See the trade-offs.","Orca SOL / USDC history, a $10,000 portfolio and a held-out strategy comparison."],
  mainnet: ["Solve3 pools. On mainnet.","Read verified pool state and inspect public-wallet positions. No signing or automation."],
  trial: [
    "A private place to try ALM.",
    "Explore real planner decisions with paper inventory. No wallet or funds needed.",
  ],
  overview: [
    "Make your liquidity work.",
    "A clearer view of your positions. A smarter way to manage your ranges.",
  ],
  positions: [
    "Every position. In perspective.",
    "Inspect your liquidity and see where each range stands.",
  ],
  strategy: [
    "Give your liquidity direction.",
    "Preview a range strategy before handing it to your keeper.",
  ],
  activity: [
    "Keep an eye on every move.",
    "A local record of what happens in your workspace.",
  ],
};
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5000);
}
function log(title, detail) {
  events.unshift({ title, detail, time: new Date() });
  renderActivity();
}
function renderActivity() {
  $("#activity-list").innerHTML = events
    .map(
      (e) =>
        `<div class="activity-row"><span class="event-icon">↗</span><div class="activity-copy"><strong>${escape(e.title)}</strong><p>${escape(e.detail)}</p></div><time datetime="${e.time.toISOString()}">${e.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>`,
    )
    .join("");
}
function navigate() {
  const view = Object.hasOwn(labels, location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview";
  $$(".view").forEach(
    (el) =>
      (el.hidden =
        el.id !== `${view}-view` &&
        !(view === "overview" && el.id === "positions-view")),
  );
  $$("nav a").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
    if (el.dataset.view === view) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("#breadcrumb").textContent = view[0].toUpperCase() + view.slice(1);
  $("#page-title").textContent = labels[view][0];
  $("#page-description").textContent = labels[view][1];
  $("#configure-button").hidden = ["strategy","mainnet","backtest"].includes(view);
  $("#data-notice").hidden = ["mainnet","backtest"].includes(view);
  $("#import-button").hidden = ["mainnet","backtest"].includes(view);
  $("#mode-badge").textContent = view === "backtest" ? "● Orca · research" : view === "mainnet" ? "● Mainnet · read-only" : snapshot ? `● ${snapshot.cluster} snapshot` : "● Demo workspace";
  window.scrollTo({ top: 0, behavior: "instant" });
}
function metric(label, value, foot, icon) {
  return `<div class="metric"><div class="metric-label">${label}<span>${icon}</span></div><div class="metric-value" title="${escape(value)}">${escape(value)}</div><div class="metric-foot">${foot}</div></div>`;
}
function renderMetrics() {
  const inRange = positions.filter((p) => p.inRange).length;
  $("#metrics").innerHTML = snapshot
    ? metric(
        "Observed balance · token A",
        units(snapshot.balanceA, snapshot.decimalsA),
        escape(short(snapshot.mintA)),
        "◈",
      ) +
      metric(
        "Observed balance · token B",
        units(snapshot.balanceB, snapshot.decimalsB),
        escape(short(snapshot.mintB)),
        "◈",
      ) +
      metric(
        "Observed positions",
        String(positions.length),
        "Inventory · management status unknown",
        "▤",
      ) +
      metric(
        "In range at observation",
        `${inRange} / ${positions.length}`,
        `Tick ${snapshot.tick} · not a live feed`,
        "⌁",
      )
    : metric(
        "Total position value",
        "$24,850.00",
        '<span class="positive">↗ 2.66%</span>illustrative weekly change',
        "↗",
      ) +
      metric(
        "Unclaimed fees",
        "$67.84",
        "Simulated fees · not claimable",
        "◈",
      ) +
      metric("Active positions", "3", "Across 3 illustrative pools", "▤") +
      metric(
        "Positions in range",
        "2 / 3",
        '<span class="positive">● 2 in range</span>1 outside range',
        "⌁",
      );
  $("#position-count").textContent = String(positions.length);
  $("#positions-total").textContent = String(positions.length);
}
function range(p) {
  return `<div class="range-labels"><span>${p.ticks ? "Tick " : "$"}${p.ticks ? p.lower : price(p.lower)}</span><span>${p.ticks ? "Tick " : "$"}${p.ticks ? p.upper : price(p.upper)}</span></div><div class="range-bar ${p.inRange ? "" : "out"}" style="--marker:${p.marker}%"><i></i></div>`;
}
function renderPositions() {
  const term = $("#search").value.toLowerCase().trim(),
    filter = $("#position-filter").value;
  const found = positions.filter(
    (p) =>
      `${p.pair} ${p.address}`.toLowerCase().includes(term) &&
      (filter === "all" || p.inRange === (filter === "in")),
  );
  $("#positions-list").innerHTML = found.length
    ? found
        .map(
          (p) =>
            `<button class="position-row" data-position="${p.id}" aria-label="View ${escape(p.pair)} position"><div class="pair"><div class="token-pair"><span class="token ${p.tokenClass}">${p.token}</span><span class="token ${snapshot ? "generic" : "usdc"}">${snapshot ? "B" : "$"}</span></div><div><span class="pair-title">${escape(p.pair)}</span><span class="pair-subtitle">${escape(p.strategy)}</span></div></div><div><span class="cell-value">${p.value === null ? "—" : money(p.value)}</span><span class="cell-sub">${escape(p.allocation)}</span></div><div>${range(p)}</div><div><span class="cell-value">${escape(p.fees)}</span><span class="cell-sub">${snapshot ? "Checkpointed token amounts" : "Simulated · USD"}</span></div><div><span class="status-pill ${p.inRange ? "" : "out"}">● ${p.inRange ? "In range" : "Out of range"}</span></div><span class="row-arrow">↗</span></button>`,
        )
        .join("")
    : '<div class="empty">No positions match this view.</div>';
}
function drawChart() {
  const disabled = !!snapshot;
  $(".performance-panel .segmented").hidden = disabled;
  $("#chart-value").textContent = disabled ? "—" : "$24,850.00";
  $("#chart-subtitle").textContent = disabled
    ? "Historical valuation unavailable in a single snapshot"
    : "Illustrative portfolio value · USD";
  $("#chart-change").innerHTML = disabled
    ? "<small>No price feed or historical data connected</small>"
    : `+$${{ "1D": "124.20", "1W": "642.80", "1M": "1,280.40" }[period]} <small>${{ "1D": "today", "1W": "this week", "1M": "this month" }[period]} · simulated</small>`;
  $(".chart-labels").hidden = disabled;
  $(".chart-footer").hidden = disabled;
  if (disabled) {
    $("#chart").innerHTML =
      '<div class="empty">Import shows observed inventory and tick ranges.<br>Portfolio history requires an indexed data source.</div>';
    return;
  }
  const values = {
    "1D": [84, 80, 86, 70, 74, 65, 68, 53, 59, 42, 46, 32, 37, 25, 29, 16],
    "1W": [
      123, 121, 126, 105, 113, 99, 101, 112, 91, 97, 76, 88, 72, 79, 59, 64, 44,
      51, 37, 42, 19, 23, 17, 26, 8,
    ],
    "1M": [
      140, 126, 137, 109, 123, 95, 102, 114, 91, 98, 76, 89, 65, 74, 51, 68, 43,
      49, 35, 46, 23, 30, 13, 24, 8,
    ],
  }[period];
  const points = values.map((v, i) => [(i / (values.length - 1)) * 600, v + 6]);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`)
    .join(" ");
  $("#chart").innerHTML =
    `<svg viewBox="0 0 600 175" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#685df7" stop-opacity=".22"/><stop offset="1" stop-color="#685df7" stop-opacity="0"/></linearGradient></defs>${[35, 85, 135].map((y) => `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="#ffffff07" stroke-dasharray="3 5"/>`).join("")}<path d="${path} L600,175 L0,175 Z" fill="url(#fill)"/><path d="${path}" fill="none" stroke="#9284ff" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="600" cy="${points.at(-1)[1]}" r="3.5" fill="#c2baff"/></svg>`;
  $("#chart").setAttribute(
    "aria-label",
    `Simulated portfolio value over ${period}. Ending value $24,850.00. No actual investment performance.`,
  );
  const ticks = {
    "1D": ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
    "1W": ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
    "1M": ["01", "05", "10", "15", "20", "25", "30"],
  }[period];
  $(".chart-labels").innerHTML = ticks.map((t) => `<span>${t}</span>`).join("");
}
function detail(id) {
  const p = positions.find((p) => p.id === id);
  if (!p) return;
  $("#position-detail").innerHTML =
    `<h2 class="detail-heading" id="position-dialog-title">${escape(p.pair)}</h2><span class="status-pill ${p.inRange ? "" : "out"}">● ${p.inRange ? "In range" : "Out of range"}${snapshot ? " at observation" : ""}</span><div class="detail-range">${range(p)}</div><div class="detail-body"><dl><div><dt>Position value</dt><dd>${p.value === null ? "Unavailable" : money(p.value)}</dd></div><div><dt>${p.ticks ? "Observed tick" : "Illustrative price"}</dt><dd>${p.ticks ? p.price : "$" + price(p.price)}</dd></div><div><dt>Unclaimed fees</dt><dd>${escape(p.fees)}</dd></div><div><dt>Liquidity</dt><dd>${escape(p.liquidity)}</dd></div><div><dt>Position</dt><dd>${escape(p.address)}</dd></div></dl><p>${snapshot ? "Imported inventory is read-only. Snapshot inclusion does not establish keeper management authorization, current balances or reward eligibility." : "This is a simulated position. To inspect your own inventory, import the JSON output of the keeper inspect command."}</p></div>`;
  $("#position-dialog").showModal();
}
function strategy() {
  return validateStrategy({
    halfWidthTicks: Number($("#width").value),
    outOfRangeSeconds: Number($("#delay").value),
    cooldownSeconds: Number($("#cooldown").value),
    maxActionsPerDay: Number($("#actions").value),
  });
}
function updateStrategyPreview() {
  const width = Number($("#width").value);
  $("#width-value").textContent = `${width} ticks`;
  $("#lower-preview").textContent = `$${price(146.8 * 1.0001 ** -width)}`;
  $("#upper-preview").textContent = `$${price(146.8 * 1.0001 ** width)}`;
  $("#strategy-visual").innerHTML =
    `<div class="preview-band" style="--band:${(width / 512) * 85 + 5}%"></div><div class="preview-price"><span>$146.80</span></div>`;
}
function updateMode() {
  $("#mode-badge").textContent = snapshot
    ? `● ${snapshot.cluster} snapshot`
    : "● Demo workspace";
  $("#data-notice>div").textContent = snapshot
    ? `Read-only observation · ${new Date(snapshot.observedAt * 1000).toLocaleString()} · slot ${snapshot.slot}. Not a live feed. Token A: ${snapshot.mintA} · Token B: ${snapshot.mintB}. Reward eligibility is unknown.`
    : "A space to explore. All balances, prices and activity below are simulated. Import a keeper snapshot to inspect observed data.";
  $("#reset-demo").hidden = !snapshot;
  $("#data-notice").style.overflowWrap = "anywhere";
  $("#positions-note").textContent = snapshot
    ? "Imported inventory is read-only. Tick bounds use [lower, upper). Values, management authorization and reward eligibility are not inferred."
    : "Demo positions illustrate the interface. No deposits or transactions are submitted.";
  $("#pause-button").disabled = !!snapshot;
  $("#pause-button").textContent = snapshot
    ? "Read-only snapshot"
    : paused
      ? "▶ Resume demo keeper"
      : "Ⅱ Pause demo keeper";
  $("#keeper-status").textContent = snapshot
    ? "● Observation only"
    : paused
      ? "Ⅱ Demo paused"
      : "● Demo active";
  $("#keeper-label").textContent = snapshot
    ? "Snapshot · no connection"
    : paused
      ? "Demo paused"
      : "Demo controls ready";
  renderMetrics();
  renderPositions();
  drawChart();
}
$("#configure-button").addEventListener("click", () => {
  location.hash = "strategy";
});
window.addEventListener("hashchange", navigate);
$("#position-filter").addEventListener("change", renderPositions);
$("#search").addEventListener("input", renderPositions);
$("#positions-list").addEventListener("click", (e) => {
  const row = e.target.closest("[data-position]");
  if (row) detail(row.dataset.position);
});
$("#close-dialog").addEventListener("click", () =>
  $("#position-dialog").close(),
);
$("#dialog-done").addEventListener("click", () =>
  $("#position-dialog").close(),
);
$$("[data-period]").forEach((b) =>
  b.addEventListener("click", () => {
    period = b.dataset.period;
    $$("[data-period]").forEach((x) => {
      x.classList.toggle("selected", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    drawChart();
  }),
);
$("#pause-button").addEventListener("click", () => {
  if (snapshot) return;
  paused = !paused;
  updateMode();
  log(
    paused ? "Demo keeper paused" : "Demo keeper resumed",
    "Local simulation only. The actual keeper process is unchanged.",
  );
  notify(
    paused
      ? "Demo paused. No real keeper was changed."
      : "Demo resumed. No real keeper was changed.",
  );
});
$("#width").addEventListener("input", updateStrategyPreview);
$("#save-strategy").addEventListener("click", () => {
  try {
    const value = strategy();
    localStorage.setItem("solve3-alm-demo-strategy", JSON.stringify(value));
    $("#keeper-cooldown").textContent = `${value.cooldownSeconds / 60} minutes`;
    log(
      "Demo strategy saved",
      `${value.halfWidthTicks} tick half-width · ${value.cooldownSeconds / 60} minute cooldown. Browser-only settings.`,
    );
    notify("Demo settings saved in this browser.");
  } catch (e) {
    notify(e.message);
  }
});
$("#export-strategy").addEventListener("click", () => {
  try {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            notice:
              "DEMO DRAFT: partial strategy settings only. Review against the actual pool and risk limits. Not an executable keeper config.",
            strategy: strategy(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "solve3-strategy-draft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Draft settings exported for review.");
  } catch (e) {
    notify(e.message);
  }
});
$("#import-button").addEventListener("click", () =>
  $("#snapshot-file").click(),
);
$("#snapshot-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error("Choose a JSON snapshot smaller than 2 MB.");
    const next = parseSnapshot(JSON.parse(await file.text()));
    snapshot = next;
    positions = snapshotPositions(snapshot);
    $("#search").value = "";
    $("#position-filter").value = "all";
    updateMode();
    log(
      "Keeper snapshot imported",
      `${snapshot.cluster} · slot ${snapshot.slot} · ${positions.length} observed positions. File stays in this browser session.`,
    );
    notify("Snapshot imported locally. No data uploaded.");
  } catch (error) {
    notify(
      error instanceof SyntaxError
        ? "This file is not valid JSON. Choose keeper inspect output."
        : error.message,
    );
  } finally {
    e.target.value = "";
  }
});
$("#reset-demo").addEventListener("click", () => {
  snapshot = null;
  positions = demoPositions;
  $("#search").value = "";
  $("#position-filter").value = "all";
  updateMode();
  log("Returned to demo", "Imported snapshot cleared from memory.");
  notify("Demo data restored.");
});
try {
  const saved = JSON.parse(
    localStorage.getItem("solve3-alm-demo-strategy") || "null",
  );
  if (saved) {
    const value = validateStrategy(saved);
    $("#width").value = value.halfWidthTicks;
    $("#delay").value = value.outOfRangeSeconds;
    $("#cooldown").value = value.cooldownSeconds;
    $("#actions").value = value.maxActionsPerDay;
    $("#keeper-cooldown").textContent = `${value.cooldownSeconds / 60} minutes`;
  }
} catch {
  /* An unavailable or corrupt browser store uses defaults. */
}
navigate();
updateMode();
updateStrategyPreview();
renderActivity();
