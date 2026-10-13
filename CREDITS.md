# Credits

Everything Ghost Lines uses that we didn't write, with its license. Models and datasets used by the
pack pipeline in `/server` get listed here as they are added.

## AI models (pack pipeline, `/server`)

Downloaded by `server/scripts/download_models.py`; licenses as listed on each model's Hugging Face page.

| Model | Used for | License | Link |
|---|---|---|---|
| Stable Diffusion XL base 1.0 (Stability AI) | Text encoders, VAE and pipeline config for image generation | CreativeML Open RAIL++-M | https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0 |
| SDXL-Lightning, 4-step UNet (ByteDance; the 8-step UNet is optional) | Fast text-to-line-art generation (4 steps, or 8) | CreativeML Open RAIL++-M | https://huggingface.co/ByteDance/SDXL-Lightning |
| MistoLine (TheMistoAI) | SDXL ControlNet that redraws a photo's lines cleanly (photo packs) | CreativeML Open RAIL++-M | https://huggingface.co/TheMistoAI/MistoLine |
| Annotators: line-art detector (lllyasviel) | Pulling line art out of a photo, via controlnet-aux | Listed as "other" on the model page | https://huggingface.co/lllyasviel/Annotators |
| OWLv2 base patch16 ensemble (Google) | Finding parts (head, ear, tail...) in a drawing from text labels | Apache-2.0 | https://huggingface.co/google/owlv2-base-patch16-ensemble |

## Fonts

| Font | Used for | License | Link |
|---|---|---|---|
| Fraunces (Undercase Type) | Headings | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Fraunces |
| Inter (Rasmus Andersson) | UI text | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Inter |

Both are loaded from Google Fonts.

## Web libraries

| Library | Used for | License | Link |
|---|---|---|---|
| React and React DOM | The user interface | MIT | https://react.dev |
| perfect-freehand | Smooth, pressure-sensitive ink strokes on the canvas | MIT | https://github.com/steveruizok/perfect-freehand |
| html-to-image | Downloading the report card as an image | MIT | https://github.com/bubkoo/html-to-image |

## Build and test tools

| Tool | Used for | License | Link |
|---|---|---|---|
| Vite and @vitejs/plugin-react | Dev server and production build | MIT | https://vite.dev |
| Vitest | Tests | MIT | https://vitest.dev |
| TypeScript | Type checking | Apache-2.0 | https://www.typescriptlang.org |
| oxlint | Linting | MIT | https://oxc.rs |
| @types/react, @types/react-dom, @types/node | Type definitions | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| GitHub Actions: checkout, setup-node, upload-pages-artifact, deploy-pages | Tests on every pull request and the GitHub Pages deploy | MIT | https://github.com/actions |

## Live server hosting

| Tool | Used for | License | Link |
|---|---|---|---|
| cloudflared (Cloudflare) | The quick tunnel that makes the live server on our GPU PC reachable from the site | Apache-2.0 | https://github.com/cloudflare/cloudflared |

## Server libraries (Python, `/server`)

Listed in `server/requirements.txt`, except torch and torchvision, which are installed separately with CUDA.

| Library | Used for | License | Link |
|---|---|---|---|
| FastAPI (built on Starlette) | The optional live API | MIT (Starlette: BSD-3-Clause) | https://fastapi.tiangolo.com |
| Uvicorn | Serving the live API | BSD-3-Clause | https://www.uvicorn.org |
| Pydantic | Validating packs against the contract | MIT | https://docs.pydantic.dev |
| NumPy | Image and stroke arrays | BSD-3-Clause (bundled parts: 0BSD, MIT, Zlib, CC0-1.0) | https://numpy.org |
| OpenCV (opencv-python) | Image processing in the pack pipeline | Apache-2.0 | https://opencv.org |
| scikit-image | Image processing in the pack pipeline | BSD-3-Clause | https://scikit-image.org |
| SciPy | Math and image helpers in the pack pipeline | BSD-3-Clause | https://scipy.org |
| Pillow | Reading and writing images | MIT-CMU | https://python-pillow.org |
| PyTorch and torchvision | Running the image models on the GPU | BSD-3-Clause (bundled parts: Apache-2.0, MIT and others) | https://pytorch.org |
| huggingface_hub | Downloading model weights (server/scripts/download_models.py) | Apache-2.0 | https://github.com/huggingface/huggingface_hub |
| Transformers | Loading Hugging Face models | Apache-2.0 | https://github.com/huggingface/transformers |
| Diffusers | Running the image generation models | Apache-2.0 | https://github.com/huggingface/diffusers |
| Accelerate | Fitting models in 8 GB of VRAM (CPU offload) | Apache-2.0 | https://github.com/huggingface/accelerate |
| safetensors | Loading model weights safely | Apache-2.0 | https://github.com/huggingface/safetensors |
| controlnet-aux | Line detectors for the photo path | Apache-2.0 | https://github.com/huggingface/controlnet_aux |
| pytest | Server tests | MIT | https://pytest.org |
