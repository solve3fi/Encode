"""Exercise menu parity and zero replacement without signing transactions."""
import argparse
import json
from playwright.sync_api import sync_playwright, TimeoutError

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://192.168.8.191:3100")
parser.add_argument("--profiles", nargs="+", default=["desktop", "mobile"])
parser.add_argument("--routes", nargs="+", default=["/en/swap", "/en/vote"])
args = parser.parse_args()

with sync_playwright() as p:
    for profile, device in [("desktop", {"viewport": {"width": 1440, "height": 1000}}),
                            ("mobile", p.devices["Pixel 7"])]:
        if profile not in args.profiles:
            continue
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(**device)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        for route in args.routes:
            page.goto(args.url + route, wait_until="domcontentloaded", timeout=180000)
            try:
                page.wait_for_load_state("networkidle", timeout=20000)
            except TimeoutError:
                pass  # Public RPC polling can remain active.
            more = page.get_by_text("More", exact=True).filter(visible=True)
            more.click()
            menu = page.get_by_role("menu")
            menu.wait_for()
            labels = menu.get_by_role("menuitem").all_text_contents()
            for expected in ["Charter", "Simulator", "Devnet", "Bribes", "Airdrop", "Documentation"]:
                assert expected in labels, (profile, route, labels)
            box = menu.bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= page.viewport_size["width"] + 1
            page.keyboard.press("Escape")
            inputs = page.locator("input.yeve-NumberInput-input:visible:not([disabled])")
            inputs.first.wait_for(timeout=60000)
            field = inputs.first
            field.fill("0")
            page.locator("body").click(position={"x": 2, "y": 100})
            field.click(position={"x": 12, "y": 20})
            field.press_sequentially("25")
            assert field.input_value() == "25", (profile, route, field.input_value())
            if route.endswith("swap"):
                field.fill("0")
                field.click(position={"x": 12, "y": 20})
                field.press_sequentially("0.25")
                assert float(field.input_value()) == 0.25, field.input_value()
            else:
                field.fill("")
                assert field.input_value() == "", field.input_value()
            assert not errors, errors
            print(json.dumps({"profile": profile, "route": route, "menu": labels,
                              "zero_replacement": "passed", "errors": errors}), flush=True)
        browser.close()
