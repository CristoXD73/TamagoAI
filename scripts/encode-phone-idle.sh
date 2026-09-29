#!/bin/zsh
# Re-encodes the iPhone's idle loop (Apple/iPhoneApp/IdleLoop.mov) from Codex's ProRes 4444 master.
#
# HEVC with alpha goes through Core Animation, which treats colour as PREMULTIPLIED by alpha. Straight colour
# (ffmpeg's default) makes every half-transparent edge pixel too bright, and the master's faint alpha noise shows
# as white specks (the owner's "really bad edges", 2026-09-28). So: drop alpha below 10/255, premultiply, then
# scale. Check the result through Apple's decoder, not ffmpeg's: ffmpeg's preview hides the problem.
set -euo pipefail
SRC="${1:-/Volumes/Storage/Projects/TamagoAI-widget-release/docs/prototypes/idle-front-v1/octopus-idle-10s-alpha.mov}"
OUT="${0:A:h}/../Apple/iPhoneApp/IdleLoop.mov"
ffmpeg -loglevel error -y -i "$SRC" -an \
  -vf "format=rgba,lutrgb=a='if(lt(val\,10)\,0\,val)',premultiply=inplace=1,scale=600:800:flags=lanczos,format=bgra" \
  -c:v hevc_videotoolbox -alpha_quality 0.8 -b:v 1000k -tag:v hvc1 -movflags +faststart "$OUT"
ls -la "$OUT"
