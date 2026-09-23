import os
import pprint
import obsws_python as obs


HOST = "127.0.0.1"
PORT = 4455

SCENE_NAME = "Tango POC Video"
INPUT_NAME = "POC Video 1"
VIDEO_PATH = r"E:\My Projects\video1.mp4"


def connect():
    password = os.environ.get("OBS_WS_PASSWORD")

    if not password:
        raise RuntimeError("OBS_WS_PASSWORD is not set.")

    return obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )


def get_scenes(client):
    response = client.get_scene_list()

    return {
        scene["sceneName"]
        for scene in response.scenes
    }


def create_scene(client):
    scenes = get_scenes(client)

    if SCENE_NAME in scenes:
        print(f"Scene already exists: {SCENE_NAME}")
        return False

    response = client.send(
        "CreateScene",
        {
            "sceneName": SCENE_NAME,
        },
        raw=True,
    )

    print("Created scene:")
    pprint.pp(response)

    return True


def create_video_input(client):
    settings = {
        "is_local_file": True,
        "local_file": VIDEO_PATH,
        "looping": False,
        "restart_on_activate": True,
        "clear_on_media_end": True,
        "buffering_mb": 2,
        "speed_percent": 100,
        "linear_alpha": False,
        "log_changes": True,
    }

    response = client.send(
        "CreateInput",
        {
            "sceneName": SCENE_NAME,
            "inputName": INPUT_NAME,
            "inputKind": "ffmpeg_source",
            "inputSettings": settings,
            "sceneItemEnabled": True,
        },
        raw=True,
    )

    print("\nCreated input:")
    pprint.pp(response)

    return response


def get_input_settings(client):
    response = client.get_input_settings(INPUT_NAME)

    print("\n=== INPUT SETTINGS ===")
    pprint.pp(response.attrs())

    return response


def get_scene_items(client):
    response = client.get_scene_item_list(SCENE_NAME)

    print("\n=== SCENE ITEMS ===")
    pprint.pp(response.attrs())

    return response


def main() -> int:
    client = connect()

    print("=== VIDEO SOURCE POC ===")
    print("Video:", VIDEO_PATH)

    if not os.path.isfile(VIDEO_PATH):
        print("ERROR: Video file does not exist.")
        return 1

    create_scene(client)
    create_video_input(client)

    get_input_settings(client)
    get_scene_items(client)

    print("\nVideo source creation: SUCCESS")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
