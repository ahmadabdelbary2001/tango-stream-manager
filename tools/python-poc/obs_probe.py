import json
import os
import obsws_python as obs

HOST = "127.0.0.1"
PORT = 4455


def main() -> int:
    password = os.environ.get("OBS_WS_PASSWORD")

    if not password:
        print("ERROR: OBS_WS_PASSWORD is not set.")
        return 1

    try:
        client = obs.ReqClient(
            host=HOST,
            port=PORT,
            password=password,
            timeout=5,
        )

        print("=== OBS VERSION ===")
        version = client.get_version()
        print("OBS:", version.obs_version)
        print("RPC:", version.rpc_version)

        print("\n=== PROFILES ===")
        profiles = client.get_profile_list()

        print("Current:", profiles.current_profile_name)
        for name in profiles.profiles:
            print(" -", name)

        print("\n=== SCENES ===")
        scenes = client.get_scene_list()

        print("Current program:",
              scenes.current_program_scene_name)

        for scene in scenes.scenes:
            print(" -", scene["sceneName"])

        print("\n=== VIDEO SETTINGS ===")
        video = client.get_video_settings()

        print(json.dumps(vars(video), indent=2, default=str))

        print("\n=== STREAM SERVICE ===")
        service = client.get_stream_service_settings()

        print("Type:", service.stream_service_type)

        settings = service.stream_service_settings.copy()

        # Never print secrets.
        for secret_name in ("key", "password", "token"):
            if secret_name in settings:
                settings[secret_name] = "<REDACTED>"

        print(json.dumps(settings, indent=2, default=str))

        print("\n=== STREAM STATUS ===")
        stream = client.get_stream_status()

        print("Active:", stream.output_active)
        print("Reconnecting:", stream.output_reconnecting)

        print("\n=== OUTPUTS ===")
        outputs = client.get_output_list()

        for output in outputs.outputs:
            print(
                f" - {output.get('outputName')} "
                f"({output.get('outputKind')}) "
                f"active={output.get('outputActive')}"
            )

        print("\nOBS snapshot: SUCCESS")
        return 0

    except Exception as exc:
        print(f"\nOBS snapshot: FAILED")
        print(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
