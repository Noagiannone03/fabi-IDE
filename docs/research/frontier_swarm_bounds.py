"""Illustrative analytical bounds, not measured inference performance.

Run with Python 3; no dependencies, files, network, or model downloads.
All storage uses decimal GB. Cache and routing calculations assume independence.
"""

from math import ceil


def main():
    print("IDEAL 4-BIT WEIGHTS ONLY; excludes overhead, state and replication")
    for billions in (671, 1000, 2800):
        gb = billions / 2
        counts = {budget: ceil(gb / budget) for budget in (4, 8, 16, 24)}
        print(f"{billions}B: {gb:g} GB; pairs by usable GB: {counts}")

    print("\nEXPOSED REMOTE LAYERS; independent local hits; 40 ms per blocked layer")
    for layers, top_k in ((75, 8), (92, 16)):
        for hit in (0.95, 0.99, 0.999):
            blocked = layers * (1 - hit**top_k)
            print(
                f"L={layers}, k={top_k}, h={hit}: "
                f"{blocked:.3f} blocked layers; {blocked * 0.04:.3f} s"
            )

    print("\nSPECULATIVE TOKENS PER ROUND; constant conditional acceptance + bonus")
    for acceptance in (0.50, 0.70, 0.85, 0.95):
        means = {
            width: round(sum(acceptance**j for j in range(width + 1)), 3)
            for width in (4, 8, 16)
        }
        print(f"acceptance={acceptance}: {means}")

    print("\nUNION OF EXPERTS PER LAYER; independent uniform top-16 over 896")
    for width in (1, 4, 8, 16, 32, 64):
        union = 896 * (1 - (1 - 16 / 896) ** width)
        print(f"tokens={width}: {union:.3f} distinct experts")

    expert_bytes = 3 * 6144 * 2048 * 4 / 8
    print(f"\nIllustrative 3-matrix expert: {expert_bytes / 1e6:.3f} MB")
    print(f"Ideal transfer at 100 Mbit/s: {expert_bytes * 8 / 100e6:.3f} s")
    print(f"39 one-way 20 ms boundaries: {39 * .02:.3f} s, excluding compute")
    print(f"Independent availability of 80 essential peers at .99: {.99**80:.3%}")
    print("Hypothetical capacity: 10,000 peers / 80 per group * 20 TPS / 10 TPS per user")
    print(f"{10000 // 80 * 20 / 10:g} simultaneous users, before other costs")


if __name__ == "__main__":
    main()
