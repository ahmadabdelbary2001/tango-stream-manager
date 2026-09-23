import os
import obsws_python as obs

HOST = "127.0.0.1"
PORT = 4455


def main() -> int:
    password = os.environ.get("OBS_WS_PASSWORD")

    if not password:
        print("ERROR: OBS_WS_PASSWORD is not set.")
        return 1

    client = obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )

    print("=== VIDEO-RELATED INPUT KINDS ===")

    result = client.get_input_kind_list(False)

    for kind in sorted(result.input_kinds):
        if any(
            keyword in kind.lower()
            for keyword in (
                "ffmpeg",
                "media",
                "browser",
                "vlc",
                "capture",
            )
        ):
            print(" -", kind)

    print("\n=== FFmpeg Media Source Defaults ===")

    try:
        defaults = client.get_input_default_settings("ffmpeg_source")
        print(defaults.attrs())
    except Exception as exc:
        print(
            "Could not read ffmpeg_source defaults:",
            f"{type(exc).__name__}: {exc}",
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
