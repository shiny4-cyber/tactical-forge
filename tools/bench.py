"""Measure the cost of a rendered frame in the real browser, before and after a visual pass.

    xvfb-run -a python3 tools/bench.py --base http://127.0.0.1:8099 --shot cover --label before

It loads the deterministic capture frame, waits for it to be painted, then times
renderer.render(scene, camera) over 120 frames and reports mean, median and p95 in
milliseconds together with the draw calls and triangles that frame costs. WebGL here is
software-rendered under Xvfb, so the absolute numbers are high; the before/after delta on the
same host and viewport is what the report uses.
"""
import argparse
import json
import statistics

from playwright.sync_api import sync_playwright

MEASURE = """
() => {
  const g = window.__game;
  const samples = [];
  for (let i = 0; i < 120; i += 1) {
    const started = performance.now();
    g.renderer.render(g.scene, g.camera);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const info = g.renderer.info.render;
  return {
    frames: samples.length,
    mean_ms: Number(mean.toFixed(3)),
    median_ms: Number(samples[Math.floor(samples.length / 2)].toFixed(3)),
    p95_ms: Number(samples[Math.floor(samples.length * 0.95)].toFixed(3)),
    triangles: info.triangles,
    calls: info.calls,
    geometries: g.renderer.info.memory.geometries,
    textures: g.renderer.info.memory.textures,
  };
}
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8099")
    parser.add_argument("--shot", default="cover")
    parser.add_argument("--label", default="run")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.firefox.launch(
            headless=False,
            firefox_user_prefs={"webgl.force-enabled": True, "webgl.disabled": False},
        )
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.goto(f"{args.base}/?shot={args.shot}&seed=3", wait_until="load")
        page.wait_for_function("() => window.__shotReady === true", timeout=30000)
        page.wait_for_timeout(200)
        first = page.evaluate(MEASURE)
        second = page.evaluate(MEASURE)
        browser.close()

    frames = [first, second]
    summary = {
        "label": args.label,
        "shot": args.shot,
        "runs": frames,
        "mean_of_runs_ms": round(statistics.mean(frame["mean_ms"] for frame in frames), 3),
        "median_of_runs_ms": round(statistics.median(frame["median_ms"] for frame in frames), 3),
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
