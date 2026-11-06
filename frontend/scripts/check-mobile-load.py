"""Read-only smoke check for client crashes across browser profiles."""
import argparse
import json
import sys
from playwright.sync_api import sync_playwright, TimeoutError

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="https://solve3.fi")
parser.add_argument("--webkit", action="store_true")
parser.add_argument("--profiles", nargs="+", default=["desktop", "android", "iphone"])
parser.add_argument("--wallet-dialog", action="store_true")
parser.add_argument("--routes", nargs="+", default=["/"])
args = parser.parse_args()
failures = 0

with sync_playwright() as p:
    profiles = [("desktop", p.chromium, {}),
                ("android", p.chromium, p.devices["Pixel 7"]),
                ("iphone", p.webkit if args.webkit else p.chromium, p.devices["iPhone 13"])]
    for name, engine, device in profiles:
        if name not in args.profiles:
            continue
        browser = engine.launch(headless=True)
        context = browser.new_context(**device)
        for route in args.routes:
            page = context.new_page()
            errors, failed = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("requestfailed", lambda request: failed.append({"url": request.url, "failure": request.failure}))
            response = page.goto(args.url.rstrip("/") + route, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except TimeoutError:
                pass  # RPC polling can keep a healthy page busy.
            page.wait_for_timeout(2500)
            if args.wallet_dialog and route == "/swap" and not errors:
                page.get_by_role("button", name="Connect Wallet", exact=True).last.click()
                page.get_by_role("dialog").wait_for(state="visible")
            body = page.locator("body").inner_text()
            crashed = "Application error:" in body
            failures += bool(errors or crashed or response.status >= 400)
            print(json.dumps({"profile": name, "route": route, "status": response.status,
                              "errors": errors, "failed": failed[:8], "body": body[:1400]}), flush=True)
            page.screenshot(path=f"/tmp/solve3-{name}-{route.strip('/').replace('/', '-') or 'home'}.png")
            page.close()
        context.close()
        browser.close()
sys.exit(1 if failures else 0)
