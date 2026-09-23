import json
import os
import sys

import obsws_python as obs


HOST = "127.0.0.1"
PORT = 4455

SCENE_NAME = "Tango POC Video"
INPUT_NAME = "POC Video 1"

CANVAS_WIDTH = 720
CANVAS_HEIGHT = 1280


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


def get_transform(
    client: obs.ReqClient,
    scene_item_id: int,
) -> dict:
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


def print_result(name: str, transform: dict) -> None:
    print(f"=== {name} RESULT ===")

    fields = [
        "positionX",
        "positionY",
        "width",
        "height",
        "scaleX",
        "scaleY",
        "rotation",
        "boundsType",
        "boundsWidth",
        "boundsHeight",
        "boundsAlignment",
        "cropToBounds",
        "cropLeft",
        "cropRight",
        "cropTop",
        "cropBottom",
    ]

    for field in fields:
        print(f"{field}: {transform.get(field)}")

    print()


def main() -> None:
    password = os.environ.get("OBS_WS_PASSWORD")

    if not password:
        fail("OBS_WS_PASSWORD is not set.")

    client = obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )

    print("=== FIT / FILL / STRETCH POC ===")
    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print(f"Canvas: {CANVAS_WIDTH} x {CANVAS_HEIGHT}")
    print()

    scene_item_id = get_scene_item_id(client)

    original = get_transform(client, scene_item_id)

    print("=== ORIGINAL ===")
    print(json.dumps(original, indent=2))
    print()

    tests = {
        "FIT": {
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

        "FILL": {
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

        "STRETCH": {
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
            print(f"=== APPLY {name} ===")

            apply_transform(
                client,
                scene_item_id,
                transform,
            )

            actual = get_transform(
                client,
                scene_item_id,
            )

            print_result(name, actual)

    finally:
        # Restore without sending the invalid 0x0 bounds values that
        # OBS returns for OBS_BOUNDS_NONE.
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

        print("=== RESTORING ORIGINAL ===")

        apply_transform(
            client,
            scene_item_id,
            restore,
        )

        restored = get_transform(
            client,
            scene_item_id,
        )

        print_result("RESTORED", restored)

    print("Fit / Fill / Stretch round trip: SUCCESS")


if __name__ == "__main__":
    main()