"""Capture real MoE routes and KV reuse on an instrumented, single GPU model.

Research instrument, not a distributed throughput benchmark or agent evaluation.
Uses synthetic public-domain code fixtures, no workspace or private prompts.
Pinned transformers 4.57.1, torch 2.8.0; run on an 80 GB GPU.
"""

import argparse
import hashlib
import json
import time
from pathlib import Path


MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"
REVISION = "0d7cf23991f47feeb3a57ecb4c9cee8ea4a17bfe"


def fixture(kind, index):
    if kind == "python":
        return f'''# file cache_{index}.py
from dataclasses import dataclass
@dataclass
class Entry{index}:
    value: str
    expires_at: float
def lookup_{index}(entries, key, now):
    entry = entries.get(key)
    if entry is None:
        return None
    if entry.expires_at < now:
        del entries[key]
        return None
    return entry.value
'''
    if kind == "typescript":
        return f'''// file queue_{index}.ts
type Job{index} = {{ id: string; attempts: number; payload: unknown }};
export async function execute{index}(job: Job{index}, run: (x: unknown) => Promise<void>) {{
  for (let n = 0; n < 3; n++) {{
    try {{ await run(job.payload); return; }}
    catch (error) {{ job.attempts++; if (n === 2) throw error; }}
  }}
}}
'''
    return f'''-- file tenant_{index}.sql
CREATE TABLE events_{index} (id BIGINT PRIMARY KEY, tenant_id BIGINT NOT NULL,
created_at TIMESTAMP NOT NULL, payload TEXT);
CREATE INDEX events_{index}_tenant_time ON events_{index}(tenant_id, created_at);
SELECT id, created_at FROM events_{index} WHERE tenant_id = 42
ORDER BY created_at DESC LIMIT 50;
'''


def main():
    import numpy as np
    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer

    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/workspace/results")
    parser.add_argument("--max-new", type=int, default=48)
    parser.add_argument("--contexts", default="2048,8192,16384")
    args = parser.parse_args()
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(8)
    torch.manual_seed(42)

    def event(**data):
        print(json.dumps({"time": time.time(), **data}), flush=True)

    event(phase="loading", model=MODEL, revision=REVISION)
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
    started = time.perf_counter()
    model = AutoModelForCausalLM.from_pretrained(
        MODEL, revision=REVISION, torch_dtype=torch.bfloat16,
        device_map="cuda:0", attn_implementation="sdpa", low_cpu_mem_usage=True,
    ).eval()
    torch.cuda.synchronize()
    metadata = {
        "model": MODEL, "revision": REVISION, "dtype": "BF16",
        "torch": torch.__version__, "transformers": transformers.__version__,
        "gpu": torch.cuda.get_device_name(), "load_seconds": time.perf_counter() - started,
        "config": model.config.to_dict(), "instrumented": True,
        "workload": "synthetic code; tool observations scripted; no real tools executed",
    }
    (outdir / "metadata.json").write_text(json.dumps(metadata, indent=2))
    event(phase="loaded", allocated=torch.cuda.memory_allocated())

    routes = [[] for _ in model.model.layers]
    enabled = True

    def hook(layer):
        def record(module, inputs, output):
            if enabled:
                # Match the actual router's float32 softmax + top-k operation.
                probs = torch.softmax(output.detach(), dim=-1, dtype=torch.float32)
                selected = torch.topk(probs, model.config.num_experts_per_tok, dim=-1).indices
                routes[layer].append(selected.to(torch.int16).cpu())
        return record

    handles = [layer.mlp.gate.register_forward_hook(hook(i))
               for i, layer in enumerate(model.model.layers)]

    def clear_routes():
        for values in routes:
            values.clear()

    def save_routes(name):
        arr = np.stack([torch.cat(values).numpy() for values in routes])
        np.savez_compressed(outdir / (name + ".npz"), routes=arr)
        clear_routes()
        return list(arr.shape)

    def forward(ids, cache=None):
        with torch.inference_mode():
            return model(input_ids=ids, past_key_values=cache, use_cache=True,
                         logits_to_keep=1, output_router_logits=False)

    def prefill(ids, cache=None):
        torch.cuda.synchronize()
        start = time.perf_counter()
        for start_index in range(0, ids.shape[1], 1024):
            result = forward(ids[:, start_index:start_index + 1024], cache)
            cache = result.past_key_values
        torch.cuda.synchronize()
        return result, time.perf_counter() - start

    def decode(result, count):
        output = []
        timings = []
        cache = result.past_key_values
        for _ in range(count):
            token = result.logits[:, -1:].argmax(-1)
            value = token.item()
            output.append(value)
            # Consume every generated token, including the last one, so the
            # cache is precisely aligned with the saved transcript.
            torch.cuda.synchronize()
            start = time.perf_counter()
            result = forward(token, cache)
            cache = result.past_key_values
            torch.cuda.synchronize()
            timings.append(time.perf_counter() - start)
            if value == tokenizer.eos_token_id:
                break
        return result, output, timings

    def cache_bytes(cache):
        return sum(t.numel() * t.element_size()
                   for layer in cache.layers for t in (layer.keys, layer.values)
                   if t is not None)

    contexts = [int(x) for x in args.contexts.split(",")]
    summaries = []
    for kind, target in zip(("python", "typescript", "sql"), contexts):
        name = f"{kind}_{target}"
        instruction = {
            "python": "Fix expiry so an entry expiring exactly now is removed. Explain briefly and show the minimal patch.",
            "typescript": "Make retries cancellation-aware with AbortSignal. Explain the minimal API change and show code.",
            "sql": "Make pagination deterministic when created_at ties, with a suitable index. Show the query and migration.",
        }[kind]
        corpus = "\n".join(fixture(kind, n) for n in range(600))
        header = tokenizer.apply_chat_template(
            [{"role": "system", "content": "You are a coding assistant. Use the supplied repository excerpt. Be concise."},
             {"role": "user", "content": "Repository excerpt:\n"}], tokenize=True,
            add_generation_prompt=False,
        )
        # Construct a well-formed chat template around a token-budgeted excerpt.
        excerpt = tokenizer.decode(tokenizer.encode(corpus, add_special_tokens=False)[:target - 128])
        messages = [
            {"role": "system", "content": "You are a coding assistant. Use the supplied repository excerpt. Be concise."},
            {"role": "user", "content": "Repository excerpt:\n" + excerpt + "\nTask: " + instruction},
        ]
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        ids = tokenizer(text, return_tensors="pt").input_ids.cuda()
        event(phase="case_start", name=name, input_tokens=ids.shape[1])
        torch.cuda.reset_peak_memory_stats()
        clear_routes()
        result, cold_seconds = prefill(ids)
        prefill_shape = save_routes(name + "_prefill")
        result, generated, timings = decode(result, args.max_new)
        decode_shape = save_routes(name + "_decode")

        # A scripted tool observation appended as a fresh user turn. It is not
        # an actual execution or a claim that the preceding answer called a tool.
        suffix = "\n<|im_end|>\n<|im_start|>user\nScripted test observation: the boundary case still fails. Check the comparison, ordering, and empty-input behavior. Give a corrected minimal patch.\n<|im_end|>\n<|im_start|>assistant\n"
        suffix_ids = tokenizer(suffix, add_special_tokens=False, return_tensors="pt").input_ids.cuda()
        cache_size = cache_bytes(result.past_key_values)
        result, warm_seconds = prefill(suffix_ids, result.past_key_values)
        warm_shape = save_routes(name + "_followup_prefill")
        warm_next = result.logits[:, -1].argmax(-1).item()
        result, followup, followup_times = decode(result, args.max_new)
        followup_shape = save_routes(name + "_followup_decode")
        final_cache_size = cache_bytes(result.past_key_values)
        total_ids = torch.cat([ids, torch.tensor([generated], device="cuda"), suffix_ids], dim=1)
        del result
        torch.cuda.empty_cache()

        # Compare cold recomputation against warm reuse for one shorter case.
        parity = None
        cold_followup_seconds = None
        if kind == "python":
            cold_result, cold_followup_seconds = prefill(total_ids)
            parity = cold_result.logits[:, -1].argmax(-1).item() == warm_next
            del cold_result
            clear_routes()
        summary = {
            "case": name, "input_tokens": ids.shape[1], "suffix_tokens": suffix_ids.shape[1],
            "cold_prefill_seconds": cold_seconds, "warm_suffix_seconds": warm_seconds,
            "cold_followup_seconds": cold_followup_seconds, "warm_cold_next_token_equal": parity,
            "decode_tokens": len(generated), "decode_seconds": sum(timings),
            "decode_step_p50_seconds": float(np.median(timings)),
            "decode_step_p95_seconds": float(np.quantile(timings, .95)),
            "followup_tokens": len(followup), "followup_seconds": sum(followup_times),
            "kv_bytes_before_followup": cache_size, "kv_bytes_final": final_cache_size,
            "peak_allocated_bytes": torch.cuda.max_memory_allocated(),
            "trace_shapes": [prefill_shape, decode_shape, warm_shape, followup_shape],
            "output": tokenizer.decode(generated), "followup_output": tokenizer.decode(followup),
            "prompt_sha256": hashlib.sha256(text.encode()).hexdigest(),
        }
        summaries.append(summary)
        (outdir / "summary.json").write_text(json.dumps(summaries, indent=2))
        (outdir / (name + "_prompt.txt")).write_text(text)
        event(phase="case_done", **{k: v for k, v in summary.items() if "output" not in k})
        del ids, total_ids
        torch.cuda.empty_cache()
    for handle in handles:
        handle.remove()
    event(phase="complete", cases=len(summaries))


if __name__ == "__main__":
    main()
