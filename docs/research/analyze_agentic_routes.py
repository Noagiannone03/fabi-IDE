"""Replay real routing traces; all network numbers are conditional simulations.

Compare equal near-tier expert capacity, not equal physical worker placement.
No claim of WAN throughput, frontier-model transfer, or serving quality.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def ranked(train, experts):
    return np.stack([np.argsort(-np.bincount(x.ravel(), minlength=experts),
                               kind="stable") for x in train])


def evaluate(trace, order, capacities, experts):
    resident = np.zeros((trace.shape[0], experts), dtype=bool)
    for layer, capacity in enumerate(capacities):
        resident[layer, order[layer, :capacity]] = True
    hits = resident[np.arange(trace.shape[0])[:, None, None], trace]
    blocked = (~hits.all(axis=2)).sum(axis=0)
    return {
        "capacity_experts": int(sum(capacities)),
        "capacity_by_layer": list(map(int, capacities)),
        "expert_hit_fraction": float(hits.mean()),
        "blocked_layers_mean": float(blocked.mean()),
        "blocked_layers_p95": float(np.quantile(blocked, .95)),
        "tokens_without_remote_experts_fraction": float((blocked == 0).mean()),
        "serial_remote_wait_ms_at_rtt40": float(blocked.mean() * 40),
    }


def barrier_plan(train, order, budget, experts, quantum=8):
    """Multiple-choice knapsack: maximize complete top-k sets served near.

    Every layer's options use its training-frequency-ranked expert prefix.
    DP is exact only within this restricted option family. Training can use
    prompt routes; future decode routes must never enter the deployable plan.
    """
    layers = train.shape[0]
    units = budget // quantum
    options = np.arange(0, experts + 1, quantum)
    scores = []
    for layer in range(layers):
        inverse = np.empty(experts, dtype=int)
        inverse[order[layer]] = np.arange(experts)
        required = inverse[train[layer]].max(axis=1) + 1
        scores.append(np.array([(required <= cap).mean() for cap in options]))
    dp = np.full(units + 1, -np.inf)
    dp[0] = 0
    parents = []
    for layer in range(layers):
        new = np.full_like(dp, -np.inf)
        choice = np.full(units + 1, -1, dtype=int)
        for option, score in enumerate(scores[layer]):
            if option > units:
                continue
            candidate = dp[:units + 1 - option] + score
            dest = new[option:]
            improve = candidate > dest
            dest[improve] = candidate[improve]
            choice[option:][improve] = option
        parents.append(choice)
        dp = new
    cursor = units
    caps = []
    for layer in reversed(range(layers)):
        option = int(parents[layer][cursor])
        assert option >= 0
        caps.append(option * quantum)
        cursor -= option
    return caps[::-1]


def lru(train, trace, capacity):
    # Hits are evaluated before inserting the current token's experts.
    misses = np.zeros(trace.shape[:2], dtype=int)
    for layer in range(trace.shape[0]):
        cache = {}
        for row in train[layer]:
            for expert in row:
                cache.pop(int(expert), None)
                cache[int(expert)] = None
                if len(cache) > capacity:
                    cache.pop(next(iter(cache)))
        for token, row in enumerate(trace[layer]):
            misses[layer, token] = sum(int(x) not in cache for x in row)
            for expert in row:
                cache.pop(int(expert), None)
                cache[int(expert)] = None
                if len(cache) > capacity:
                    cache.pop(next(iter(cache)))
    return {"expert_hit_fraction": float(1 - misses.sum() / trace.size),
            "blocked_layers_mean": float((misses > 0).sum(axis=0).mean()),
            "admissions_per_token": float(misses.sum(axis=0).mean())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    config = json.loads((args.directory / "metadata.json").read_text())["config"]
    experts = config["num_experts"]
    layers = config["num_hidden_layers"]
    report = {"scope": "offline trace replay, single GPU synthetic code, no WAN benchmark",
              "assumptions": ["all misses within one layer overlap perfectly",
                              "separate layers impose serial expert RPC barriers",
                              "near-tier capacity is abstract; physical feasibility not measured",
                              "40 ms hypothetical RPC excludes computation, queues and payload time"],
              "cases": []}
    for summary in json.loads((args.directory / "summary.json").read_text()):
        name = summary["case"]
        def read(phase):
            return np.load(args.directory / f"{name}_{phase}.npz")["routes"]
        prompt, decode = read("prefill"), read("decode")
        suffix, followup = read("followup_prefill"), read("followup_decode")
        assert decode.shape[0] == layers and decode.min() >= 0 and decode.max() < experts
        case = {"name": name, "generation_tokens": decode.shape[1], "policies": {}, "blocks": {}}
        for phase, train, trace in [("first", prompt, decode),
                                    ("followup", np.concatenate([prompt, decode, suffix], axis=1), followup)]:
            policies = {}
            order = ranked(train, experts)
            for cap in (8, 16, 32, 64, 96, 120, 128):
                policies[f"uniform_{cap}"] = evaluate(trace, order, [cap] * layers, experts)
            cap = experts // 2
            budget = layers * cap
            concentrated = [experts] * (layers // 2) + [0] * (layers - layers // 2)
            policies["complete_layers_half_budget"] = evaluate(trace, order, concentrated, experts)
            plan = barrier_plan(train, order, budget, experts)
            policies["barrier_dp_half_budget"] = evaluate(trace, order, plan, experts)
            tail = train[:, -128:]
            tail_order = ranked(tail, experts)
            tail_plan = barrier_plan(tail, tail_order, budget, experts)
            policies["barrier_dp_tail128_half_budget"] = evaluate(trace, tail_order, tail_plan, experts)
            # Hindsight comparator, unavailable to a live scheduler.
            oracle_order = ranked(trace, experts)
            oracle_plan = barrier_plan(trace, oracle_order, budget, experts)
            policies["hindsight_barrier_dp_half_budget"] = evaluate(trace, oracle_order, oracle_plan, experts)
            policies["lru_64"] = lru(train, trace, 64)
            assert policies["uniform_128"]["blocked_layers_mean"] == 0
            assert policies["complete_layers_half_budget"]["blocked_layers_mean"] == layers / 2
            for policy, values in policies.items():
                if "half_budget" in policy:
                    assert values["capacity_experts"] == budget
            case["policies"][phase] = policies
        for block in (1, 4, 8, 16):
            unions = [len(np.unique(decode[layer, start:start + block]))
                      for layer in range(layers)
                      for start in range(0, decode.shape[1] - block + 1, block)]
            case["blocks"][str(block)] = {"mean_experts_per_layer": float(np.mean(unions)),
                                          "p95_experts_per_layer": float(np.quantile(unions, .95)),
                                          "note": "accepted-sequence windows, not measured speculative proposals"}
        report["cases"].append(case)
    path = args.directory / "route_analysis.json"
    path.write_text(json.dumps(report, indent=2))
    print(path)
    for case in report["cases"]:
        print(case["name"])
        for phase, policies in case["policies"].items():
            print(phase, {k: round(v["blocked_layers_mean"], 2) for k, v in policies.items()})
        print("blocks", case["blocks"])


if __name__ == "__main__":
    main()
