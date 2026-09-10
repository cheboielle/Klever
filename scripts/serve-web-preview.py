"""Serve an Expo web-only export on loopback, including long Windows asset paths."""
import argparse
import functools
import http.server
import os
from pathlib import Path


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # pnpm's nested font asset names can exceed MAX_PATH on Windows.
        # Normalize before adding the prefix: extended paths do not normalize '/'.
        translated = os.path.normpath(os.path.abspath(super().translate_path(path)))
        if os.name == "nt" and not translated.startswith("\\\\?\\"):
            translated = "\\\\?\\" + translated
        return translated


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--port", type=int, default=8085)
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    if not (directory / "index.html").is_file():
        parser.error("Choose an Expo web export containing index.html")
    handler = functools.partial(PreviewHandler, directory=str(directory))
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()
