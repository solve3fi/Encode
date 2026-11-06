import { units, short } from "./model.js";
const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let localTrial;
let session = null,
  view = null,
  busy = false;
const titles = {
  empty: "Start with idle tokens",
  "in-range": "Position is in range",
  waiting: "Waiting for the delay",
  rebalance: "Ready to rebalance",
  "one-sided": "One-sided inventory",
  paused: "Liquidity increases paused",
};
const reasonText = {
  "position-in-range":
    "The position is inside its range. No rebalance is needed.",
  "out-of-range-observation-delay":
    "The position moved out of range. Keep observing until the configured delay passes.",
  cooldown: "The last paper action is still inside the rebalance cooldown.",
  "insufficient-two-sided-inventory-no-swap":
    "Both tokens are required to open this range. The keeper does not swap to force a deposit.",
  "liquidity-increases-paused":
    "The synthetic pool has paused liquidity increases. Owner exit remains available.",
  "no-managed-positions":
    "There are no eligible managed positions for this action.",
  "retained-position-limit":
    "Clean up settled positions before opening more. Unpaid claims must be retained.",
  "daily-action-limit": "The daily strategy action limit has been reached.",
};
async function act(action) {
  if (busy) return;
  busy = true;
  $("#trial-error").textContent = "";
  setBusy();
  try {
    if (document.documentElement.dataset.trialRuntime === "browser") {
      const { Trial, trialAction } = await import("./trial-engine.js");
      const parsed = trialAction.parse(action);
      if (parsed.action === "start") localTrial = new Trial(parsed.scenario);
      else {
        if (!localTrial) throw new Error("Load a scenario first.");
        localTrial.act(parsed);
      }
      view = { session: "browser-paper-session", ...localTrial.view() };
    } else {
      const response = await fetch(new URL("./api/trial", location.href), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session ? { "x-alm-session": session } : {}),
        },
        body: JSON.stringify(action),
      });
      if (!response.ok) {
        let message = "Start the private trial with bun run start (port 4183).";
        try {
          message = (await response.json()).error || message;
        } catch {}
        if (response.status === 410) {
          session = null;
          view = null;
        }
        throw new Error(message);
      }
      view = await response.json();
    }
    session = view.session;
    render();
  } catch (error) {
    $("#trial-error").textContent = error.message;
  } finally {
    busy = false;
    setBusy();
  }
}
function setBusy() {
  document
    .querySelectorAll("#trial-view button")
    .forEach(
      (b) =>
        (b.disabled = busy || (!session && b.dataset.needsSession === "true")),
    );
  $("#trial-apply").disabled = busy || !view?.plan || view.plan.kind === "hold";
}
function render() {
  const s = view.snapshot,
    p = view.plan;
  $("#trial-clock").textContent =
    `Paper clock · ${new Date(view.now * 1000).toLocaleString()}`;
  $("#trial-balances").innerHTML = [
    ["Idle token A", units(s.balanceA, 6)],
    ["Idle token B", units(s.balanceB, 6)],
    ["Paper actions today", view.actionsToday],
    ["Illustrative cost · SOL", units(view.costToday, 9)],
  ]
    .map(
      ([label, value]) =>
        `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value" title="${esc(value)}">${esc(value)}</div></div>`,
    )
    .join("");
  $("#trial-tick").value = s.tick;
  $("#trial-half-width").value = view.strategy.halfWidthTicks;
  $("#trial-delay").value = view.strategy.outOfRangeSeconds;
  $("#trial-cooldown").value = view.strategy.cooldownSeconds;
  $("#trial-limit").value = view.strategy.maxActionsPerDay;
  $("#trial-plan-kind").textContent = p
    ? p.kind === "hold"
      ? "Hold position"
      : `Preview: ${p.kind}`
    : "Evaluate your next move";
  $("#trial-plan-reasons").innerHTML = p
    ? p.reasons.length
      ? p.reasons.map((r) => `<p>${esc(reasonText[r] || r)}</p>`).join("")
      : `<p>The keeper checks passed for this synthetic observation. Review the preview, then apply it to paper inventory.</p>`
    : "<p>Market or settings changed. Generate a fresh preview before applying an action.</p>";
  $("#trial-plan-fields").innerHTML = p
    ? `<div><dt>Tick range</dt><dd>${p.lower} → ${p.upper}</dd></div><div><dt>Maximum token A / B</dt><dd>${units(p.maxA, 6)} / ${units(p.maxB, 6)}</dd></div><div><dt>Planned liquidity</dt><dd>${esc(p.liquidity)}</dd></div><div><dt>Preview ID</dt><dd title="${p.id}">${short(p.id)}</dd></div><div><dt>Expires at paper time</dt><dd>${new Date(p.expiresAt * 1000).toLocaleTimeString()}</dd></div>`
    : "";
  $("#trial-positions").innerHTML = s.positions.length
    ? s.positions
        .map(
          (p) =>
            `<div class="trial-position"><strong>${short(p.address)}</strong><span>Ticks ${p.lower} → ${p.upper}</span><span>${BigInt(p.liquidity) > 0n ? (s.tick >= p.lower && s.tick < p.upper ? "● In range" : "● Out of range") : "Retained · zero liquidity"}</span><small>Liquidity ${esc(p.liquidity)} · owed fees ${units(p.feeA, 6)} A / ${units(p.feeB, 6)} B</small></div>`,
        )
        .join("")
    : '<div class="empty">No paper positions. Preview an open to get started.</div>';
  $("#trial-receipts").innerHTML = view.receipts
    .slice(0, 15)
    .map(
      (r) =>
        `<div class="activity-row"><span class="event-icon">◇</span><div class="activity-copy"><strong>${esc(r.kind)}</strong><p>${esc(r.note)}</p></div><time>${new Date(r.at * 1000).toLocaleTimeString()}</time></div>`,
    )
    .join("");
  $("#trial-summary").textContent =
    `Current tick ${s.tick} · ${s.positions.filter((p) => BigInt(p.liquidity) > 0n).length} active · ${s.positions.length} total positions`;
}
$("#trial-start").addEventListener("click", () =>
  act({
    action: session ? "reset" : "start",
    scenario: $("#trial-scenario").value,
  }),
);
$("#trial-scenario").addEventListener("change", () => {
  $("#trial-scenario-description").textContent =
    titles[$("#trial-scenario").value];
});
$("#trial-market").addEventListener("click", () =>
  act({
    action: "market",
    tick: Number($("#trial-tick").value),
    seconds: Number($("#trial-seconds").value),
  }),
);
document
  .querySelectorAll("[data-trial-purpose]")
  .forEach((b) =>
    b.addEventListener("click", () =>
      act({ action: "evaluate", purpose: b.dataset.trialPurpose }),
    ),
  );
$("#trial-apply").addEventListener("click", () => {
  if (view?.plan) act({ action: "apply", planId: view.plan.id });
});
$("#trial-settings").addEventListener("click", () =>
  act({
    action: "settings",
    halfWidthTicks: Number($("#trial-half-width").value),
    outOfRangeSeconds: Number($("#trial-delay").value),
    cooldownSeconds: Number($("#trial-cooldown").value),
    maxActionsPerDay: Number($("#trial-limit").value),
  }),
);
$("#trial-export").addEventListener("click", () => {
  if (!view) return;
  const { session: _, ...receipt } = view;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "solve3-paper-trial.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setBusy();
