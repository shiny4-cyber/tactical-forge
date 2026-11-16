"""Check captured screenshots against the entry's image limits and against blackness.

Run with the interpreter that has Pillow (/usr/bin/python3 on this host):

  /usr/bin/python3 tools/imagecheck.py --dir screenshots

It prints one JSON line per image with bytes, dimensions, mean luminance, luminance spread and
the near-black fraction, and exits 1 if any image breaks a limit or reads as an empty frame.
This is the mechanical backstop for a vision review that the session's vision tool cannot
perform; it cannot tell you the scene is attractive, only that it is not dark, flat or huge.
"""
import argparse
import json
import os
import sys

from PIL import Image

MAX_BYTES = 256 * 1024
LONG_SIDE_MAX = 1280
SHORT_SIDE_MIN = 480


def stats_for(path):
    with Image.open(path) as image:
        image.load()
        rgb = image.convert("RGB")
        width, height = rgb.size
        pixels = rgb.tobytes()
    count = width * height
    total = 0.0
    total_sq = 0.0
    dark = 0
    for index in range(0, len(pixels), 3):
        r = pixels[index]
        g = pixels[index + 1]
        b = pixels[index + 2]
        value = 0.2126 * r + 0.7152 * g + 0.0722 * b
        total += value
        total_sq += value * value
        if value < 12:
            dark += 1
    mean = total / count
    spread = max(0.0, total_sq / count - mean * mean) ** 0.5
    return {
        "file": os.path.basename(path),
        "bytes": os.path.getsize(path),
        "width": width,
        "height": height,
        "mean_luminance": round(mean, 2),
        "luminance_spread": round(spread, 2),
        "dark_fraction": round(dark / count, 4),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="screenshots")
    parser.add_argument("--min-mean", type=float, default=25.0)
    parser.add_argument("--min-spread", type=float, default=18.0)
    parser.add_argument("--max-dark", type=float, default=0.5)
    args = parser.parse_args()

    names = sorted(
        name
        for name in os.listdir(args.dir)
        if name.lower().endswith((".jpg", ".jpeg", ".png")) and not name.startswith(".")
    )
    failures = []
    if not 3 <= len(names) <= 4:
        failures.append(f"expected 3 or 4 images, found {len(names)}")
    rows = []
    for name in names:
        path = os.path.join(args.dir, name)
        row = stats_for(path)
        rows.append(row)
        if row["bytes"] > MAX_BYTES:
            failures.append(f"{name}: {row['bytes']} bytes over 256 KiB")
        if max(row["width"], row["height"]) > LONG_SIDE_MAX:
            failures.append(f"{name}: long side {max(row['width'], row['height'])} over {LONG_SIDE_MAX}")
        if min(row["width"], row["height"]) < SHORT_SIDE_MIN:
            failures.append(f"{name}: short side under {SHORT_SIDE_MIN}")
        if row["mean_luminance"] < args.min_mean:
            failures.append(f"{name}: too dark (mean {row['mean_luminance']})")
        if row["luminance_spread"] < args.min_spread:
            failures.append(f"{name}: flat frame (spread {row['luminance_spread']})")
        if row["dark_fraction"] > args.max_dark:
            failures.append(f"{name}: {row['dark_fraction']} of the frame is near-black")
        print(json.dumps(row))

    summary = {
        "images": len(rows),
        "total_bytes": sum(row["bytes"] for row in rows),
        "min_mean_luminance": min((row["mean_luminance"] for row in rows), default=0),
        "min_spread": min((row["luminance_spread"] for row in rows), default=0),
        "max_dark_fraction": max((row["dark_fraction"] for row in rows), default=0),
    }
    print(json.dumps({"_summary": summary}))
    if failures:
        print("FAIL")
        for failure in failures:
            print(" -", failure)
        sys.exit(1)
    print("PASS")


if __name__ == "__main__":
    main()
