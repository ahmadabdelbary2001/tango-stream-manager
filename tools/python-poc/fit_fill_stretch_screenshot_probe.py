import json
import os
import sys
from pathlib import Path

import obsws_python as obs


HOST = "127.0.0.1"
PORT = 4455

SCENE_NAME = "Tango POC Video"
INPUT_NAME = "POC Video 1"

CANVAS_WIDTH = 720
CANVAS_HEIGHT = 1280

OUTPUT_DIR = Path(r"E:\My Projects\tango-transform-screenshots")


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    sys.exit(1)


def get_scene_item_id(client: obs.ReqClient) -> int:
    response = client.send(
        "GetSceneItemList",
        {
            "sceneName": SCENE_NAME,
        },
        raw=True,
    )

    for item in response.get("sceneItems", []):
        if item.get("sourceName") == INPUT_NAME:
            return item["sceneItemId"]

    fail(f"Scene item '{INPUT_NAME}' was not found.")
    return -1


def get_transform(client: obs.ReqClient, scene_item_id: int) -> dict:
    response = client.send(
        "GetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
        },
        raw=True,
    )

    return response["sceneItemTransform"]


def apply_transform(
    client: obs.ReqClient,
    scene_item_id: int,
    transform: dict,
) -> None:
    client.send(
        "SetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
            "sceneItemTransform": transform,
        },
        raw=True,
    )


def save_screenshot(
    client: obs.ReqClient,
    path: Path,
) -> None:
    client.send(
        "SaveSourceScreenshot",
        {
            "sourceName": SCENE_NAME,
            "imageFormat": "png",
            "imageFilePath": str(path),
            "imageWidth": CANVAS_WIDTH,
            "imageHeight": CANVAS_HEIGHT,
        },
        raw=True,
    )


def main() -> None:
    password = os.environ.get("OBS_WS_PASSWORD")

    if not password:
        fail("OBS_WS_PASSWORD is not set.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    client = obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )

    print("=== FIT / FILL / STRETCH SCREENSHOT POC ===")
    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print(f"Canvas: {CANVAS_WIDTH} x {CANVAS_HEIGHT}")
    print(f"Output directory: {OUTPUT_DIR}")
    print()

    scene_item_id = get_scene_item_id(client)

    original = get_transform(client, scene_item_id)

    print("=== ORIGINAL TRANSFORM ===")
    print(json.dumps(original, indent=2))
    print()

    tests = {
        "fit": {
            "positionX": 0.0,
            "positionY": 0.0,
            "rotation": 0.0,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "alignment": 5,
            "boundsType": "OBS_BOUNDS_SCALE_INNER",
            "boundsAlignment": 5,
            "boundsWidth": float(CANVAS_WIDTH),
            "boundsHeight": float(CANVAS_HEIGHT),
            "cropToBounds": False,
        },
        "fill": {
            "positionX": 0.0,
            "positionY": 0.0,
            "rotation": 0.0,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "alignment": 5,
            "boundsType": "OBS_BOUNDS_SCALE_OUTER",
            "boundsAlignment": 5,
            "boundsWidth": float(CANVAS_WIDTH),
            "boundsHeight": float(CANVAS_HEIGHT),
            "cropToBounds": True,
        },
        "stretch": {
            "positionX": 0.0,
            "positionY": 0.0,
            "rotation": 0.0,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "alignment": 5,
            "boundsType": "OBS_BOUNDS_STRETCH",
            "boundsAlignment": 5,
            "boundsWidth": float(CANVAS_WIDTH),
            "boundsHeight": float(CANVAS_HEIGHT),
            "cropToBounds": False,
        },
    }

    try:
        for name, transform in tests.items():
            print(f"=== APPLY {name.upper()} ===")

            apply_transform(
                client,
                scene_item_id,
                transform,
            )

            screenshot_path = OUTPUT_DIR / f"{name}.png"

            save_screenshot(
                client,
                screenshot_path,
            )

            print(f"Screenshot: {screenshot_path}")

            actual = get_transform(
                client,
                scene_item_id,
            )

            print(
                json.dumps(
                    {
                        "boundsType": actual.get("boundsType"),
                        "boundsWidth": actual.get("boundsWidth"),
                        "boundsHeight": actual.get("boundsHeight"),
                        "boundsAlignment": actual.get("boundsAlignment"),
                        "cropToBounds": actual.get("cropToBounds"),
                        "scaleX": actual.get("scaleX"),
                        "scaleY": actual.get("scaleY"),
                    },
                    indent=2,
                )
            )

            print()

    finally:
        print("=== RESTORING ORIGINAL ===")

        restore = {
            "positionX": original["positionX"],
            "positionY": original["positionY"],
            "rotation": original["rotation"],
            "scaleX": original["scaleX"],
            "scaleY": original["scaleY"],
            "alignment": original["alignment"],
            "boundsType": original["boundsType"],
            "boundsAlignment": original["boundsAlignment"],
            "cropToBounds": original["cropToBounds"],
            "cropLeft": original["cropLeft"],
            "cropRight": original["cropRight"],
            "cropTop": original["cropTop"],
            "cropBottom": original["cropBottom"],
        }

        apply_transform(
            client,
            scene_item_id,
            restore,
        )

        restored = get_transform(
            client,
            scene_item_id,
        )

        print(
            json.dumps(
                restored,
                indent=2,
            )
        )

        print()
        print("Original transform restored.")

    print()
    print("Screenshot POC: SUCCESS")


if __name__ == "__main__":
    main()