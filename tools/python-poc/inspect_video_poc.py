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

    print("=== VIDEO SOURCE INSPECTION ===")
    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print()

    # ------------------------------------------------------------
    # 1. Get source settings
    # ------------------------------------------------------------
    print("=== INPUT SETTINGS ===")

    input_response = client.send(
        "GetInputSettings",
        {
            "inputName": INPUT_NAME,
        },
        raw=True,
    )

    print(json.dumps(input_response, indent=2, ensure_ascii=False))
    print()

    # ------------------------------------------------------------
    # 2. Find the scene item ID dynamically
    # ------------------------------------------------------------
    print("=== SCENE ITEMS ===")

    scene_response = client.send(
        "GetSceneItemList",
        {
            "sceneName": SCENE_NAME,
        },
        raw=True,
    )

    print(json.dumps(scene_response, indent=2, ensure_ascii=False))
    print()

    scene_items = scene_response.get("sceneItems", [])

    matching_item = next(
        (
            item
            for item in scene_items
            if item.get("sourceName") == INPUT_NAME
        ),
        None,
    )

    if matching_item is None:
        fail(
            f"Could not find scene item for input '{INPUT_NAME}'."
        )

    scene_item_id = matching_item["sceneItemId"]

    print("=== RESOLVED SCENE ITEM ===")
    print(f"sceneItemId: {scene_item_id}")
    print()

    # ------------------------------------------------------------
    # 3. Get transform
    # ------------------------------------------------------------
    print("=== SCENE ITEM TRANSFORM ===")

    transform_response = client.send(
        "GetSceneItemTransform",
        {
            "sceneName": SCENE_NAME,
            "sceneItemId": scene_item_id,
        },
        raw=True,
    )

    print(
        json.dumps(
            transform_response,
            indent=2,
            ensure_ascii=False,
        )
    )
    print()

    # ------------------------------------------------------------
    # 4. Media status
    # ------------------------------------------------------------
    print("=== MEDIA STATUS ===")

    try:
        media_response = client.send(
            "GetMediaInputStatus",
            {
                "inputName": INPUT_NAME,
            },
            raw=True,
        )

        print(
            json.dumps(
                media_response,
                indent=2,
                ensure_ascii=False,
            )
        )
    except Exception as exc:
        print(f"Media status unavailable: {exc}")

    print()
    print("Video source inspection: SUCCESS")


if __name__ == "__main__":
    main()