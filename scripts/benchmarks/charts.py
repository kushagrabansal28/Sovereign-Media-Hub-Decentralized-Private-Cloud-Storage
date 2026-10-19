"""Draws charts from the CSV files in docs/benchmarks. Nothing is hard-coded:
every plotted value is read from a CSV written by the benchmark scripts."""
import csv
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2] / "docs" / "benchmarks"
OUT = ROOT / "charts"
OUT.mkdir(exist_ok=True)

ACCENT = "#9a5a0c"
NEUTRAL = "#6a655d"
LIGHT = "#c5bfb4"

plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.edgecolor": NEUTRAL,
        "axes.labelcolor": "#1c1a17",
        "xtick.color": "#1c1a17",
        "ytick.color": "#1c1a17",
        "figure.dpi": 150,
        "axes.titlesize": 11,
        "axes.titleweight": "bold",
        "axes.titlelocation": "left",
    }
)


def rows(name):
    path = ROOT / name
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT / name)
    plt.close(fig)
    print("wrote", OUT / name)


# Deduplication ---------------------------------------------------------
d = rows("dedup.csv")
if d:
    labels = [f"{float(r['duplicate_rate_target']) * 100:.0f}%" for r in d]
    logical = [int(r["logical_bytes"]) / 1048576 for r in d]
    stored = [int(r["stored_bytes"]) / 1048576 for r in d]
    savings = [float(r["savings_percent"]) for r in d]
    fig, ax = plt.subplots(figsize=(6.2, 3.4))
    x = range(len(d))
    w = 0.38
    ax.bar([i - w / 2 for i in x], logical, w, label="Sent by clients", color=LIGHT)
    ax.bar([i + w / 2 for i in x], stored, w, label="Stored on disk", color=ACCENT)
    for i, s in zip(x, savings):
        ax.text(i + w / 2, stored[i] + max(logical) * 0.015, f"{s:.1f}% saved", ha="center", fontsize=8)
    ax.set_xticks(list(x), labels)
    ax.set_xlabel("Share of uploads that repeat an earlier file")
    ax.set_ylabel("MiB")
    ax.set_title("Content addressing: bytes sent vs bytes stored (100 uploads)")
    ax.legend(frameon=False, loc="upper right")
    save(fig, "dedup.png")

# Upload ---------------------------------------------------------------
u = rows("upload.csv")
if u:
    by = defaultdict(list)
    for r in u:
        by[float(r["size_mb"])].append(r)
    sizes = sorted(by)
    med = lambda key, s: statistics.median(float(r[key]) for r in by[s])  # noqa: E731
    lo = lambda key, s: min(float(r[key]) for r in by[s])  # noqa: E731
    hi = lambda key, s: max(float(r[key]) for r in by[s])  # noqa: E731

    fig, ax = plt.subplots(figsize=(6.2, 3.4))
    for key, label, color, marker in (
        ("upload_ms", "Upload (PUT /upload)", ACCENT, "o"),
        ("duplicate_put_ms", "Upload of identical bytes", NEUTRAL, "s"),
        ("hash_ms", "SHA-256 in the client", "#1f5f9e", "^"),
    ):
        y = [med(key, s) for s in sizes]
        err = [[med(key, s) - lo(key, s) for s in sizes], [hi(key, s) - med(key, s) for s in sizes]]
        ax.errorbar(sizes, y, yerr=err, label=label, color=color, marker=marker, capsize=2, linewidth=1.4)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xticks(sizes, [f"{s:g}" for s in sizes])
    ax.set_xlabel("File size (MB)")
    ax.set_ylabel("Time (ms), median with min–max")
    ax.set_title("Hashing and upload time by file size (5 runs each)")
    ax.legend(frameon=False)
    save(fig, "upload_time.png")

    fig, ax = plt.subplots(figsize=(6.2, 3.0))
    tp = [med("throughput_mb_s", s) for s in sizes]
    ax.bar([f"{s:g}" for s in sizes], tp, color=ACCENT)
    for i, v in enumerate(tp):
        ax.text(i, v + max(tp) * 0.01, f"{v:.0f}", ha="center", fontsize=8)
    ax.set_xlabel("File size (MB)")
    ax.set_ylabel("MB/s, median")
    ax.set_title("Upload throughput on loopback")
    save(fig, "upload_throughput.png")

# Concurrency ----------------------------------------------------------
c = rows("concurrency.csv")
if c:
    fig, ax = plt.subplots(figsize=(6.2, 3.0))
    n = [r["concurrency"] for r in c]
    v = [float(r["aggregate_mb_s"]) for r in c]
    ax.bar(n, v, color=ACCENT)
    for i, val in enumerate(v):
        ax.text(i, val + max(v) * 0.01, f"{val:.0f}", ha="center", fontsize=8)
    ax.set_xlabel("Parallel uploads")
    ax.set_ylabel("Aggregate MB/s")
    ax.set_title("Eight 5 MB files at increasing concurrency")
    save(fig, "concurrency.png")

# Relay ----------------------------------------------------------------
r = rows("relay.csv")
if r:
    q = [x for x in r if x["metric"] == "query_all_events"]
    cold = [x for x in q if "cold" in x["detail"]]
    warm = [x for x in q if "warm" in x["detail"]]
    if cold and warm:
        fig, ax = plt.subplots(figsize=(6.2, 3.2))
        labels = [x["detail"].split(" events")[0] for x in cold]
        w = 0.38
        xs = range(len(cold))
        cv = [float(x["value"]) for x in cold]
        wv = [float(x["value"]) for x in warm]
        ax.bar([i - w / 2 for i in xs], cv, w, label="First load: every event verified", color=ACCENT)
        ax.bar([i + w / 2 for i in xs], wv, w, label="Refresh: events already cached", color=LIGHT)
        for i in xs:
            ax.text(i - w / 2, cv[i] + max(cv) * 0.01, f"{cv[i]:.0f} ms", ha="center", fontsize=8)
            ax.text(i + w / 2, wv[i] + max(cv) * 0.01, f"{wv[i]:.0f} ms", ha="center", fontsize=8)
        ax.set_xticks(list(xs), labels)
        ax.set_xlabel("Events in the library")
        ax.set_ylabel("ms, median of 3")
        ax.set_title("Fetching a whole library from a relay (500 events per page)")
        ax.legend(frameon=False)
        save(fig, "relay_query.png")

# Gallery --------------------------------------------------------------
g = rows("gallery.csv")
if g:
    want = [
        ("first_tile_visible", "First tile"),
        ("first_thumbnail_decoded", "First thumbnail"),
        ("all_events_rendered", "All items laid out"),
        ("first_original_ready", "First original (viewer)"),
        ("cache_first_tile", "First tile from cache, relay down"),
    ]
    vals = {x["metric"]: float(x["value"]) for x in g}
    items = [(label, vals[k]) for k, label in want if k in vals]
    if items:
        fig, ax = plt.subplots(figsize=(6.2, 3.0))
        ax.barh([i[0] for i in items][::-1], [i[1] for i in items][::-1], color=ACCENT)
        for i, (_, v) in enumerate(items[::-1]):
            ax.text(v + max(v2 for _, v2 in items) * 0.01, i, f"{v:.0f} ms", va="center", fontsize=8)
        ax.set_xlabel("ms")
        ax.set_title("Gallery with 3 000 items (headless Chrome, loopback)")
        save(fig, "gallery_timing.png")
