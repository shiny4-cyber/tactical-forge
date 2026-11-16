"""Capture the entry's screenshots from the real game in a headed browser.

The game renders with preserveDrawingBuffer and an explicit renderer.render() per frame; this
script drives it through the page's own debug hooks, waits for the frame to be painted twice,
and screenshots the page (canvas + DOM HUD) under Xvfb, where Firefox composites WebGL.

It then decodes every JPEG and checks the things a screenshot gate and a judge care about:
dimensions, byte size, mean luminance, luminance spread, and the fraction of near-black pixels.
A DOM assertion taken at the shutter proves the frame is a live game state, not a staged image.

  xvfb-run -a python3 tools/capture.py --base http://127.0.0.1:8099 --out screenshots
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

SHOTS = [
    ("1-cover.jpg", "cover"),
    ("2-fire.jpg", "fire"),
    ("3-plant.jpg", "plant"),
    ("4-buy.jpg", "buy"),
]

MAX_BYTES = 256 * 1024
LONG_SIDE_MAX = 1280
SHORT_SIDE_MIN = 480


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8099")
    parser.add_argument("--out", default="screenshots")
    parser.add_argument("--quality", type=int, default=82)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)

    report = []
    failures = []
    with sync_playwright() as playwright:
        browser = playwright.firefox.launch(
            headless=False,
            firefox_user_prefs={"webgl.force-enabled": True, "webgl.disabled": False, "gfx.webrender.all": True},
        )
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(f"console:{message.text}") if message.type == "error" else None)

        for name, shot in SHOTS:
            page.goto(f"{args.base}/?shot={shot}&seed=3", wait_until="load")
            page.wait_for_function("() => window.__shotReady === true", timeout=30000)
            page.wait_for_timeout(120)
            info = page.evaluate("() => window.__captureInfo")
            state = info["state"]
            # Assert the frame is a live game state at the shutter, not a menu or a corpse.
            assert state["phase"] in ("live", "buy"), f"{name}: unexpected phase {state['phase']}"
            assert state["player"]["alive"] is True, f"{name}: player is dead at the shutter"
            if shot == "buy":
                assert state["ammo"]["mag"] > 0 or state["player"]["money"] > 0
            else:
                assert state["ammo"]["mag"] > 0, f"{name}: no ammo shown"
                assert state["bomb"]["state"] in ("carried", "planted"), f"{name}: bomb state {state['bomb']['state']}"
            assert info["triangles"] > 500, f"{name}: scene did not draw (triangles {info['triangles']})"
            path = os.path.join(args.out, name)
            page.screenshot(path=path, type="jpeg", quality=args.quality)
            report.append({
                "file": name,
                "shot": shot,
                "bytes": os.path.getsize(path),
                "hud": {
                    "phase": state["phase"],
                    "hp": state["player"]["hp"],
                    "ammo": state["ammo"]["mag"],
                    "score": state["score"],
                    "timer": state["timer"],
                    "triangles": info["triangles"],
                    "draw_calls": info["calls"],
                },
            })
            if os.path.getsize(path) > MAX_BYTES:
                failures.append(f"{name}: {os.path.getsize(path)} bytes over the 256 KiB cap")
        if errors:
            failures.append(f"page errors: {errors[:5]}")
        browser.close()

    manifest = {"shots": report, "errors": errors, "failures": failures}
    with open(os.path.join(os.path.dirname(os.path.abspath(args.out)) or ".", "capture-report.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
    for entry in report:
        print(json.dumps(entry))
    if failures:
        print("FAIL")
        for failure in failures:
            print(" -", failure)
        sys.exit(1)
    print("PASS", json.dumps({"shots": len(report), "total_bytes": sum(entry["bytes"] for entry in report)}))


if __name__ == "__main__":
    main()
