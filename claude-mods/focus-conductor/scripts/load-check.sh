#!/bin/bash
# Kiểm độ ổn định của bộ test dưới tải (0.7.5, R12): chạy cả bộ test RUNS lần song song, mỗi lần trên bản sao riêng của cây, cùng LOAD
# tiến trình đốt CPU. In các test đỏ của từng lần. Mặc định 3 lần, 4 tiến trình tải; CLAUDE là engine 2.1.296 mà CI ghim.
# Cách dùng: scripts/load-check.sh [thư mục kết quả]
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-/tmp/load-check}
RUNS=${RUNS:-3}
LOAD=${LOAD:-4}
CLAUDE=${CLAUDE:-claude}
rm -rf "$OUT" && mkdir -p "$OUT"
pids=()
for i in $(seq 1 "$RUNS"); do
  mkdir -p "$OUT/w$i" && cp -r "$HERE/." "$OUT/w$i/"
  (cd "$OUT/w$i" && "$CLAUDE" plugin test . > "$OUT/run$i.log" 2>&1) &
  pids+=($!)
done
burners=()
for _ in $(seq 1 "$LOAD"); do
  (while :; do :; done) &
  burners+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
kill "${burners[@]}" 2>/dev/null
for i in $(seq 1 "$RUNS"); do
  echo "== lần $i"
  grep -E "^\(fail\)| pass$| fail$" "$OUT/run$i.log"
done
