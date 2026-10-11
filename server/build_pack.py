"""Builds one subject pack (images + pack.json) for web/public/subjects.

Stub for now: it reads the arguments and prints TODO. The /build-pack skill calls it like this:
    python server/build_pack.py --subject fox --difficulty medium --prompt "fox"
    python server/build_pack.py --subject fox --difficulty medium --photo path/to/fox.jpg
"""

import argparse

# Must match Difficulty in web/src/engine/types.ts.
DIFFICULTIES = ["simple", "medium", "detailed"]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a Ghost Lines subject pack.")
    # A pack starts from either a text prompt (text to line art) or a photo (photo to line art).
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--prompt", help="text prompt for the line art, e.g. 'fox'")
    source.add_argument("--photo", help="path to a photo to turn into line art")
    parser.add_argument("--subject", required=True, help="subject id, e.g. 'fox'")
    parser.add_argument("--difficulty", required=True, choices=DIFFICULTIES)
    parser.add_argument("--seed", type=int, default=0, help="random seed, so a build can be repeated")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    source = f"prompt {args.prompt!r}" if args.prompt is not None else f"photo {args.photo!r}"
    print(f"TODO: build pack {args.subject}-{args.difficulty} from {source} with seed {args.seed}")


if __name__ == "__main__":
    main()
