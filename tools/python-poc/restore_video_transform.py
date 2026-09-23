import json
import os
import sys

import obsws_python as obs


HOST = "127.0.0.1"
PORT = 4455

SCENE_NAME = "Tango POC Video"
INPUT_NAME = "POC Video 1"


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    sys.exit(1)


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

    response = client.send(
        "GetSceneItemList",
        {
            "sceneName": SCENE_NAME,
        },
        raw=True,
    )

    scene_item_id = None

    for item in response.get("sceneItems", []):
        if item.get("sourceName") == INPUT_NAME:
            scene_item_id = item["sceneItemId"]
            break

    if scene_item_id is None:
        fail(f"Scene item '{INPUT_NAME}' was not found.")

    print("=== RESTORING VIDEO TRANSFORM ===")
    print(f"Scene item ID: {scene_item_id}")

    # IMPORTANT:
    # Do NOT send boundsWidth/boundsHeight when boundsType is NONE.
    restore_transform = {
        "positionX": 0.0,
        "positionY": 0.0,
        "rotation": 0.0,
        "scaleX": 1.0,
        "scaleY": 1.0,
        "alignment": 5,
        "boundsType": "OBS_BOUNDS_NONE",
        "boundsAlignment": 0,
        "cropToBounds": False,
        "cropLeft": 0,
        "cropRight": 0,
        "cropTop": 0,
        "cropBottom": 0,
    }

    print()
    print("Applying:")
    print(json.dumps(restore_transform, indent=2))
    print()

    client.send(
        "SetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
            "sceneItemTransform": restore_transform,
        },
        raw=True,
    )

    verify = client.send(
        "GetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
        },
        raw=True,
    )

    actual = verify["sceneItemTransform"]

    print("=== AFTER RESTORE ===")
    print(json.dumps(actual, indent=2))
    print()

    checks = {
        "positionX": actual["positionX"] == 0.0,
        "positionY": actual["positionY"] == 0.0,
        "rotation": actual["rotation"] == 0.0,
        "scaleX": actual["scaleX"] == 1.0,
        "scaleY": actual["scaleY"] == 1.0,
        "alignment": actual["alignment"] == 5,
        "boundsType": actual["boundsType"] == "OBS_BOUNDS_NONE",
        "cropToBounds": actual["cropToBounds"] is False,
        "cropLeft": actual["cropLeft"] == 0,
        "cropRight": actual["cropRight"] == 0,
        "cropTop": actual["cropTop"] == 0,
        "cropBottom": actual["cropBottom"] == 0,
    }

    success = True

    print("=== VALIDATION ===")

    for field, ok in checks.items():
        print(f"{field}: {'PASS' if ok else 'FAIL'}")
        success &= ok

    print()

    if not success:
        print("Transform restore: FAILED")
        sys.exit(1)

    print("Transform restore: SUCCESS")


if __name__ == "__main__":
    main()