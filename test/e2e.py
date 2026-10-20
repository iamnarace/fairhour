"""Browser tests for fairhour's interface.

Runs the real page in headless Chromium. Requires Python 3.10+ and Playwright:

    pip install playwright && playwright install chromium
    python test/e2e.py
"""

from __future__ import annotations

import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:
        pass


def serve() -> tuple[socketserver.TCPServer, str]:
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


def fresh(page: Page, url: str) -> None:
    page.goto(url)
    page.evaluate("localStorage.clear()")
    page.goto(url)
    page.get_by_role("button", name="Load the example team").click()
    expect(page.locator(".headline")).to_contain_text("Sydney time")


def test_example_plan(page: Page, url: str) -> None:
    fresh(page, url)
    expect(page.locator(".headline")).to_have_text("Rotate between 21:30, 01:00 and 12:30 Sydney time.")
    expect(page.locator(".explain")).to_contain_text("down from 42 with the best fixed time (22:00)")
    expect(page.locator("tbody tr")).to_have_count(12)
    expect(page.locator(".notice.dst")).to_contain_text("New York's clocks go back")


def test_fixed_time(page: Page, url: str) -> None:
    fresh(page, url)
    page.get_by_label("1 time (fixed)").check()
    expect(page.locator(".headline")).to_have_text("Meet at 22:00 Sydney time.")
    expect(page.locator(".bar-value .was")).to_have_count(0)


def test_edit_team(page: Page, url: str) -> None:
    fresh(page, url)
    page.get_by_role("button", name="Remove Arjun").click()
    expect(page.locator("thead th")).to_have_count(4)
    page.get_by_role("button", name="Add a person").click()
    name = page.locator(".person").last.get_by_label("Name")
    expect(name).to_be_focused()
    name.fill("Kenji")
    zone = page.get_by_label("Time zone for Kenji")
    zone.fill("Not/AZone")
    expect(zone).to_have_attribute("aria-invalid", "")
    expect(page.locator(".person").last.locator(".field-error")).to_be_visible()
    zone.fill("Asia/Tokyo")
    expect(zone).not_to_have_attribute("aria-invalid", "")
    expect(page.locator("thead th").last).to_have_text("Kenji")


def test_persistence_and_share(page: Page, url: str) -> None:
    fresh(page, url)
    page.get_by_label("Meeting name").fill("Design review")
    page.wait_for_timeout(300)
    page.reload()
    expect(page.get_by_label("Meeting name")).to_have_value("Design review")

    page.get_by_role("button", name="Share link").click()
    expect(page.locator(".toast")).to_contain_text("Link copied")
    link = page.evaluate("navigator.clipboard.readText()")
    assert "#plan=1." in link, link
    page.evaluate("localStorage.clear()")
    page.goto(link)
    expect(page.locator(".toast")).to_contain_text("Opened a shared plan")
    expect(page.get_by_label("Meeting name")).to_have_value("Design review")
    assert page.evaluate("location.hash") == ""


def test_broken_link(page: Page, url: str) -> None:
    page.goto(url + "#plan=1.broken")
    expect(page.locator(".toast.error")).to_contain_text("looks incomplete")


def test_calendar_download(page: Page, url: str) -> None:
    fresh(page, url)
    with page.expect_download() as info:
        page.get_by_role("button", name="Download calendar (.ics)").click()
    download = info.value
    assert download.suggested_filename == "product-sync.ics"
    raw = Path(download.path()).read_bytes()
    text = raw.decode("utf-8")
    assert text.count("BEGIN:VEVENT") == 12
    assert "SUMMARY:Product sync (1 of 12)" in text
    assert raw.count(b"\n") == raw.count(b"\r\n"), "every line must end in CRLF"


def test_mobile_layout(page: Page, url: str) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    fresh(page, url)
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0, f"page scrolls sideways by {overflow}px"


def main() -> int:
    server, url = serve()
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        tests = [obj for name, obj in globals().items() if name.startswith("test_")]
        for test in tests:
            context = browser.new_context(
                timezone_id="Australia/Sydney",
                locale="en-AU",
                permissions=["clipboard-read", "clipboard-write"],
                accept_downloads=True,
                viewport={"width": 1280, "height": 900},
            )
            # Fix "today" so the example series always starts on Tue 27 Oct 2026.
            context.add_init_script("""(() => {
              const fixed = new Date('2026-10-20T01:00:00Z').valueOf();
              const RealDate = Date;
              class FixedDate extends RealDate {
                constructor(...args) { super(...(args.length ? args : [fixed])); }
                static now() { return fixed; }
              }
              globalThis.Date = FixedDate;
            })();""")
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            try:
                test(page, url)
                assert not errors, f"console errors: {errors}"
                print(f"ok   {test.__name__}")
            except Exception as exc:  # noqa: BLE001 - report every failure
                failures += 1
                print(f"FAIL {test.__name__}: {exc}")
            finally:
                context.close()
        browser.close()
    server.shutdown()
    print(f"\n{len(tests) - failures} passed, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
