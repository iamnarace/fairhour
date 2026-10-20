"""Regenerate docs/screenshots from the running app (pip install playwright && playwright install chromium)."""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "test"))
from e2e import serve  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
FIXED_DATE = """(() => {
  const fixed = new Date('2026-10-20T01:00:00Z').valueOf();
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  globalThis.Date = FixedDate;
})();"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    server, url = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        shots = [
            ("plan-desktop.png", {"width": 1360, "height": 1000}, "light", "full"),
            ("plan-dark.png", {"width": 1360, "height": 1000}, "dark", "viewport"),
            ("overlap-chart.png", {"width": 1360, "height": 1000}, "light", "overlap"),
            ("plan-mobile.png", {"width": 390, "height": 844}, "light", "plan"),
        ]
        for name, viewport, scheme, mode in shots:
            context = browser.new_context(
                viewport=viewport,
                device_scale_factor=2,
                color_scheme=scheme,
                timezone_id="Australia/Sydney",
                locale="en-AU",
                is_mobile=viewport["width"] < 600,
            )
            context.add_init_script(FIXED_DATE)
            page = context.new_page()
            page.goto(url)
            page.get_by_role("button", name="Load the example team").click()
            page.wait_for_selector(".headline")
            page.locator(".toast-region").evaluate("el => el.replaceChildren()")
            target = OUT / name
            if mode == "full":
                page.screenshot(path=target, full_page=True)
            elif mode == "overlap":
                page.locator(".overlap").screenshot(path=target)
            elif mode == "plan":
                page.locator("#plan").scroll_into_view_if_needed()
                page.evaluate("document.getElementById('plan').scrollIntoView()")
                page.screenshot(path=target)
            else:
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=target)
            context.close()
            print(target.relative_to(OUT.parent.parent))
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
