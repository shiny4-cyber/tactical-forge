"""End-to-end browser tests for CINDER YARD.

Run under Xvfb, because headless Firefox does not composite WebGL into screenshots and the
game's own rendering path is part of what is under test:

    xvfb-run -a python3 tests/browser.py

The script serves game/ on an ephemeral localhost port, drives a headed Firefox through the
page's debug hooks (the same calls the loop makes), and asserts the player-facing outcomes:
buying a weapon, reaching the live phase, firing and consuming ammo, planting and detonating
to win, defusing to win, the next round starting, and zero page errors. It also measures the
simulation's cost so a per-frame allocation regression fails the suite.
"""
import http.server
import json
import os
import sys
import threading
import time
import urllib.parse
from functools import partial

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game")

results = []


def check(name, condition, detail=""):
    results.append({"check": name, "ok": bool(condition), "detail": detail})
    print(("PASS " if condition else "FAIL ") + name + (f" :: {detail}" if detail else ""))
    if not condition:
        raise AssertionError(f"{name} failed: {detail}")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    handler = partial(QuietHandler, directory=directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def open_game(page, base, query):
    page.goto(f"{base}/?{query}", wait_until="load")
    page.wait_for_function("() => window.__debug !== undefined", timeout=20000)
    page.evaluate("() => window.__startMatch()")


def advance(page, seconds):
    return page.evaluate("(s) => window.__advance(s)", seconds)


def main():
    server, port = serve(GAME)
    base = f"http://127.0.0.1:{port}"
    errors = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.firefox.launch(
                headless=False,
                firefox_user_prefs={"webgl.force-enabled": True, "webgl.disabled": False},
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
            page.on("console", lambda message: errors.append(f"console:{message.text}") if message.type == "error" else None)

            # --- session 1: a real match with bots, buy and fire -------------------------
            open_game(page, base, "seed=11")
            start = page.evaluate("() => window.__debug()")
            check("the match starts in a buy phase with four opponents", start["phase"] == "buy" and len([b for b in start["bots"] if b["team"] == "defenders"]) == 4, json.dumps(start["phase"]))
            check("the HUD shows the round clock", page.evaluate("() => window.__hudText()")["timer"] != "", page.evaluate("() => window.__hudText()"))

            money_before = start["player"]["money"]
            bought = page.evaluate("() => window.__buy('spark')")
            check("a weapon can be bought during the buy phase", bought["ok"] is True, json.dumps(bought))
            after_buy = page.evaluate("() => window.__debug()")
            check("the purchase is paid for", after_buy["player"]["money"] == money_before - 500, f"{money_before} -> {after_buy['player']['money']}")
            check("the bought weapon is in hand with its magazine", after_buy["ammo"]["weapon"] == "spark" and after_buy["ammo"]["mag"] == 12, json.dumps(after_buy["ammo"]))
            check("the HUD names the weapon", page.evaluate("() => window.__hudText()")["weapon"] == "SPARK")

            live = advance(page, 13)
            check("the round goes live after the buy phase", live["phase"] == "live", live["phase"])
            check("the round clock is counting down", live["timer"] < 100, str(live["timer"]))

            # A click without pointer lock must not fire: the input guard is part of the game.
            page.mouse.click(640, 360)
            locked_guard = page.evaluate("() => window.__debug()")
            check("an unlocked click does not fire", locked_guard["ammo"]["mag"] == 12, json.dumps(locked_guard["ammo"]))

            shot = page.evaluate("() => window.__fire(1)")
            check("firing consumes a round", shot["mag"] == 11, json.dumps(shot))
            hud_ammo = page.evaluate("() => window.__hudText()")
            check("the HUD ammo follows the magazine", hud_ammo["ammo"] == "11", json.dumps(hud_ammo))
            page.evaluate("() => window.__reload()")
            reloaded = advance(page, 1.6)
            check("a reload refills from the reserve", reloaded["ammo"]["mag"] == 12 and reloaded["ammo"]["reserve"] == 47, json.dumps(reloaded["ammo"]))

            cost = page.evaluate(
                """() => {
                    const started = performance.now();
                    window.__advance(1);
                    return performance.now() - started;
                }"""
            )
            check("one simulated second with eight actors stays cheap", cost < 120, f"{cost:.1f} ms")

            # --- session 2: plant, detonate, next round ----------------------------------
            open_game(page, base, "nobots=1&seed=12")
            planted = advance(page, 13)
            check("a practice round reaches the live phase", planted["phase"] == "live", planted["phase"])
            page.evaluate("() => window.__tp(-13, -12, 0)")
            page.evaluate("() => window.__plant(true)")
            plant_state = advance(page, 3.6)
            check("the charge plants on site A", plant_state["bomb"]["state"] == "planted" and plant_state["bomb"]["site"] == "A", json.dumps(plant_state["bomb"]))
            page.evaluate("() => window.__plant(false)")
            check("the HUD announces the armed charge", "ARMED" in page.evaluate("() => window.__hudText()")["bomb"], page.evaluate("() => window.__hudText()")["bomb"])
            detonated = advance(page, 41)
            check("the fuse detonates and wins the round for the attackers", detonated["result"]["winner"] == "attackers" and detonated["result"]["reason"] == "detonation", json.dumps(detonated["result"]))
            check("the score moved", detonated["score"]["attackers"] == 1, json.dumps(detonated["score"]))
            next_round = advance(page, 7)
            check("the next round opens in a buy phase", next_round["phase"] == "buy" and next_round["round"] == 2, f"{next_round['phase']} r{next_round['round']}")
            check("the bomb is back in hand for the new round", next_round["bomb"]["state"] == "carried", json.dumps(next_round["bomb"]))

            # --- session 3: defuse and win as a defender ---------------------------------
            open_game(page, base, "side=defenders&nobots=1&seed=13")
            armed = advance(page, 13)
            check("the defender session is live", armed["phase"] == "live", armed["phase"])
            page.evaluate("() => window.__armBomb('B')")
            page.evaluate("() => window.__tp(13, -11, 0)")
            page.evaluate("() => window.__defuse(true)")
            partial = advance(page, 4)
            check("the defuse timer runs while the key is held", partial["bomb"]["defuse"] > 3.5, json.dumps(partial["bomb"]))
            page.evaluate("() => window.__defuse(false)")
            released = advance(page, 0.2)
            check("letting go resets the defuse timer", released["bomb"]["defuse"] == 0, json.dumps(released["bomb"]))
            page.evaluate("() => window.__defuse(true)")
            defused = advance(page, 11)
            check("a full defuse wins the round for the defenders", defused["result"]["winner"] == "defenders" and defused["result"]["reason"] == "defuse", json.dumps(defused["result"]))
            check("the defenders' score moved", defused["score"]["defenders"] == 1, json.dumps(defused["score"]))

            # --- session 4: the start screen and side choice ------------------------------
            page.goto(f"{base}/?seed=14", wait_until="load")
            page.wait_for_function("() => window.__debug !== undefined", timeout=20000)
            visible = page.evaluate("() => !document.getElementById('start').hidden")
            check("the start screen is visible on load", visible is True)
            check("both sides are offered", page.evaluate("() => document.querySelectorAll('[data-side]').length") == 2)
            page.click("#start-button")
            time.sleep(0.3)
            check("clicking play hides the start screen", page.evaluate("() => document.getElementById('start').hidden") is True)

            # The animation loop itself: the buy clock runs on its own and the scene draws
            # without a hook driving it.
            first = page.evaluate("() => window.__debug()['timer']")
            time.sleep(1.4)
            second = page.evaluate("() => window.__debug()['timer']")
            check("the buy clock runs on the live loop", second < first, f"{first} -> {second}")
            triangles = page.evaluate("() => window.__game.renderer.info.render.triangles")
            check("the live loop is drawing the map", triangles > 2000, str(triangles))

            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    check("no page errors in any session", len(errors) == 0, json.dumps(errors[:4]))
    passed = sum(1 for entry in results if entry["ok"])
    print(json.dumps({"checks": len(results), "passed": passed, "failed": len(results) - passed}))
    if passed != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
