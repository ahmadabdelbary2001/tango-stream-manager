import os
import pprint
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

    result = client.get_input_default_settings("ffmpeg_source")

    print("=== FFMPEG SOURCE DEFAULT SETTINGS ===")
    pprint.pp(result.default_input_settings)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
