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

    print("=== TRANSFORM ROUND TRIP POC ===")

    scene_item_id = get_scene_item_id(client)

    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print(f"Scene Item ID: {scene_item_id}")
    print()

    # ------------------------------------------------------------
    # Capture original state
    # ------------------------------------------------------------

    original = get_transform(client, scene_item_id)

    print("=== ORIGINAL TRANSFORM ===")
    print(json.dumps(original, indent=2))
    print()

    # ------------------------------------------------------------
    # Apply controlled test transform
    #
    # These values are intentionally obvious so we can verify
    # that OBS actually changed every property.
    # ------------------------------------------------------------

    test_transform = {
        "positionX": 50.0,
        "positionY": 75.0,
        "rotation": 10.0,
        "scaleX": 1.25,
        "scaleY": 1.25,
    }

    print("=== APPLY TEST TRANSFORM ===")
    print(json.dumps(test_transform, indent=2))
    print()

    client.send(
        "SetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
            "sceneItemTransform": test_transform,
        },
        raw=True,
    )

    applied = get_transform(client, scene_item_id)

    print("=== AFTER APPLY ===")
    print(json.dumps(applied, indent=2))
    print()

    # ------------------------------------------------------------
    # Validate
    # ------------------------------------------------------------

    checks = {
        "positionX": applied.get("positionX") == 50.0,
        "positionY": applied.get("positionY") == 75.0,
        "rotation": applied.get("rotation") == 10.0,
        "scaleX": applied.get("scaleX") == 1.25,
        "scaleY": applied.get("scaleY") == 1.25,
    }

    print("=== VALIDATION ===")

    success = True

    for field, ok in checks.items():
        print(f"{field}: {'PASS' if ok else 'FAIL'}")
        success &= ok

    print()

    # ------------------------------------------------------------
    # Restore original transform
    # ------------------------------------------------------------

    print("=== RESTORE ORIGINAL ===")

    client.send(
        "SetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
            "sceneItemTransform": original,
        },
        raw=True,
    )

    restored = get_transform(client, scene_item_id)

    print(json.dumps(restored, indent=2))
    print()

    restoration_ok = restored == original

    print(
        f"Restoration: {'SUCCESS' if restoration_ok else 'FAILED'}"
    )

    if not success or not restoration_ok:
        sys.exit(1)

    print()
    print("Transform round trip: SUCCESS")


if __name__ == "__main__":
    main()