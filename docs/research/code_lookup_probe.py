"""Test an existing exact-greedy proposal mechanism with no extra draft model.

Uses Transformers' prompt lookup implementation, not a newly invented decoder.
Single GPU, synthetic coding examples, no claim of frontier/WAN performance.
"""
import argparse
import json
import time
from pathlib import Path

from agentic_trace_probe import MODEL, REVISION, fixture


def main():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/workspace/results")
    args = parser.parse_args()
    out = Path(args.out)
    torch.set_num_threads(8)
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL, revision=REVISION, torch_dtype=torch.bfloat16,
        device_map="cuda:0", attn_implementation="sdpa", local_files_only=True,
    ).eval()
    calls = []
    def before(module, inputs, kwargs):
        calls.append(int(kwargs["input_ids"].shape[1]))
    handle = model.register_forward_pre_hook(before, with_kwargs=True)
    prompts = {
        "copy_edit": "Return only a Python code block containing this entire file, changing only the expiry comparison to also expire at equality.\n```python\n" + fixture("python", 0) + "```",
        "new_algorithm": "Write a Python function topological_sort(graph) for a dict of node to dependencies, raising ValueError on cycles. Include a brief explanation. Do not use external packages.",
    }
    results = []
    # Warm kernels once, outside all measurements.
    warm = tokenizer("def add(a, b):", return_tensors="pt").to("cuda")
    with torch.inference_mode():
        model.generate(**warm, max_new_tokens=2, do_sample=False)
    for name, prompt in prompts.items():
        rendered = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}], tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(rendered, return_tensors="pt").to("cuda")
        pair = {"case": name, "input_tokens": int(inputs.input_ids.shape[1]),
                "scope": "cold prompt, batch=1, max_new=192; one run per variant"}
        baseline = None
        for policy in ("greedy", "lookup8"):
            calls.clear()
            extra = {} if policy == "greedy" else {"prompt_lookup_num_tokens": 8, "max_matching_ngram_size": 3}
            torch.cuda.synchronize()
            start = time.perf_counter()
            with torch.inference_mode():
                output = model.generate(**inputs, max_new_tokens=192, do_sample=False,
                                        use_cache=True, **extra)
            torch.cuda.synchronize()
            seconds = time.perf_counter() - start
            tokens = output[0, inputs.input_ids.shape[1]:].tolist()
            if baseline is None:
                baseline = tokens
            pair[policy] = {"seconds": seconds, "output_tokens": len(tokens),
                            "target_forward_calls": len(calls), "forward_widths": calls.copy(),
                            "same_tokens_as_greedy": tokens == baseline,
                            "output_token_ids": tokens, "text": tokenizer.decode(tokens)}
            print(json.dumps({"case": name, "policy": policy, "seconds": seconds,
                              "tokens": len(tokens), "calls": len(calls),
                              "parity": tokens == baseline}), flush=True)
        pair["speedup"] = pair["greedy"]["seconds"] / pair["lookup8"]["seconds"]
        results.append(pair)
        (out / "code_lookup.json").write_text(json.dumps(results, indent=2))
    handle.remove()


if __name__ == "__main__":
    main()
