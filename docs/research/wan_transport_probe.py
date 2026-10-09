"""Measure this Mac's actual encrypted echo path to an authorized test host.

This is an SSH transport probe, not P2P model inference or raw-link latency.
No workspace content is transmitted; deterministic synthetic bytes only.
"""
import argparse
import json
import shlex
import statistics
import struct
import subprocess
import time
from pathlib import Path


SERVER = '''import sys,struct
r=sys.stdin.buffer;w=sys.stdout.buffer
def exact(n):
 b=bytearray()
 while len(b)<n:
  x=r.read(n-len(b))
  if not x: raise EOFError()
  b.extend(x)
 return bytes(b)
try:
 while True:
  n=struct.unpack("!I",exact(4))[0]
  b=exact(n);w.write(struct.pack("!I",n)+b);w.flush()
except EOFError: pass
'''


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    p.add_argument("--port", required=True, type=int)
    p.add_argument("--identity", required=True)
    p.add_argument("--known-hosts", required=True)
    p.add_argument("--out", required=True, type=Path)
    a = p.parse_args()
    command = ["ssh", "-T", "-i", a.identity, "-p", str(a.port),
               "-o", "Compression=no", "-o", "ConnectTimeout=15",
               "-o", "UserKnownHostsFile=" + a.known_hosts, a.host,
               "python -u -c " + shlex.quote(SERVER)]
    def exact(stream, count):
        buf = bytearray()
        while len(buf) < count:
            data = stream.read(count - len(buf))
            if not data:
                raise RuntimeError("SSH echo closed")
            buf.extend(data)
        return bytes(buf)
    samples = []
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for size in (1, 4096, 16384, 65536, 262144):
            payload = bytes(range(256)) * (size // 256) + bytes(range(size % 256))
            times = []
            for n in range(14):
                start = time.perf_counter()
                proc.stdin.write(struct.pack("!I", size) + payload)
                proc.stdin.flush()
                length = struct.unpack("!I", exact(proc.stdout, 4))[0]
                assert length == size and exact(proc.stdout, size) == payload
                elapsed = (time.perf_counter() - start) * 1000
                if n >= 2:
                    times.append(elapsed)
            samples.append({"payload_bytes_each_way": size, "rtt_ms": times,
                            "median_ms": statistics.median(times), "max_ms": max(times)})
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    result = {"scope": "single real Mac-to-RunPod US-MD SSH echo; no inference",
              "timestamp": time.time(), "compression": False, "samples": samples}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2))
    print(json.dumps([{k: v for k, v in row.items() if k != "rtt_ms"} for row in samples]))


if __name__ == "__main__":
    main()
