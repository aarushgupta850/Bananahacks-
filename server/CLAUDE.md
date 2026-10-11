# Server rules (/server)

- Runs on Aarush's Windows PC with an NVIDIA RTX 4060 Ti.
  Python venv at server/.venv (Windows: server\.venv\Scripts\activate). torch is installed separately with CUDA.
- HF_HOME is set in .env. Model weights live outside the repo.
- If VRAM is 8 GB or less, use pipe.enable_model_cpu_offload().
- Text to line art: SDXL-Lightning (4 steps, guidance 0) with the prompt in pipeline/prompts.py.
  ControlNet is ONLY for the photo path, because it needs an input image.
- Every pack must validate against the pydantic models in pipeline/schema.py, which mirror
  web/src/engine/types.ts exactly. Coordinates are in 768 x 768 space.
- Quality gate: 6 to 60 strokes per pack; otherwise regenerate.
- Pipeline images: webp, 300 KB or less each.
- Live API: one job at a time, 25 s timeout, prompts of 40 characters or less checked against a blocklist,
  CORS only for https://aarushgupta850.github.io and http://localhost:5173.
- Tests: pytest with synthetic images. Tests must not need the GPU.
- Add each model's name, link and license to CREDITS.md the first time you use it.
