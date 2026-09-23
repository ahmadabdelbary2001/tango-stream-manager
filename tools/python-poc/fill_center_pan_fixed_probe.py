import json
import os
import sys
from pathlib import Path

import obsws_python as obs


HOST = "127.0.0.1"
PORT = 4455

SCENE_NAME = "Tango POC Video"
INPUT_NAME = "POC Video 1"

CANVAS_WIDTH = 720.0
CANVAS_HEIGHT = 1280.0

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


def save_scene_screenshot(
    client: obs.ReqClient,
    path: Path,
) -> None:
    client.send(
        "SaveSourceScreenshot",
        {
            "sourceName": SCENE_NAME,
            "imageFormat": "png",
            "imageFilePath": str(path),
            "imageWidth": int(CANVAS_WIDTH),
            "imageHeight": int(CANVAS_HEIGHT),
        },
        raw=True,
    )


def print_transform(name: str, transform: dict) -> None:
    print(f"=== {name} ===")

    fields = [
        "positionX",
        "positionY",
        "width",
        "height",
        "scaleX",
        "scaleY",
        "rotation",
        "alignment",
        "boundsType",
        "boundsAlignment",
        "boundsWidth",
        "boundsHeight",
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

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    client = obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )

    print("=== FIXED FILL + CENTER + PAN POC ===")
    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print(
        f"Canvas: "
        f"{CANVAS_WIDTH:.0f} x {CANVAS_HEIGHT:.0f}"
    )
    print()

    scene_item_id = get_scene_item_id(client)

    original = get_transform(
        client,
        scene_item_id,
    )

    print_transform(
        "ORIGINAL",
        original,
    )

    source_width = float(
        original["sourceWidth"]
    )
    source_height = float(
        original["sourceHeight"]
    )

    # ------------------------------------------------------------
    # Calculate Fill manually.
    #
    # No OBS bounds are used.
    # ------------------------------------------------------------

    scale = max(
        CANVAS_WIDTH / source_width,
        CANVAS_HEIGHT / source_height,
    )

    rendered_width = source_width * scale
    rendered_height = source_height * scale

    overflow_x = max(
        0.0,
        rendered_width - CANVAS_WIDTH,
    )

    overflow_y = max(
        0.0,
        rendered_height - CANVAS_HEIGHT,
    )

    max_pan_x = overflow_x / 2.0
    max_pan_y = overflow_y / 2.0

    center_x = CANVAS_WIDTH / 2.0
    center_y = CANVAS_HEIGHT / 2.0

    left_position_x = center_x - max_pan_x
    right_position_x = center_x + max_pan_x

    top_position_y = center_y - max_pan_y
    bottom_position_y = center_y + max_pan_y

    print("=== FILL GEOMETRY ===")
    print(f"sourceWidth: {source_width}")
    print(f"sourceHeight: {source_height}")
    print(f"scale: {scale}")
    print(
        f"renderedWidth: {rendered_width}"
    )
    print(
        f"renderedHeight: {rendered_height}"
    )
    print(f"overflowX: {overflow_x}")
    print(f"overflowY: {overflow_y}")
    print(f"maxPanX: {max_pan_x}")
    print(f"maxPanY: {max_pan_y}")
    print()

    print("=== POSITIONS ===")
    print(
        f"left:   {left_position_x}"
    )
    print(
        f"center: {center_x}"
    )
    print(
        f"right:  {right_position_x}"
    )
    print(
        f"top:    {top_position_y}"
    )
    print(
        f"bottom: {bottom_position_y}"
    )
    print()

    # ------------------------------------------------------------
    # Important:
    # boundsType = NONE
    #
    # The OBS canvas itself clips content outside its boundaries.
    # ------------------------------------------------------------

    base_transform = {
        "positionY": center_y,
        "rotation": 0.0,

        "scaleX": scale,
        "scaleY": scale,

        # OBS_ALIGN_CENTER
        "alignment": 0,

        # No bounds.
        "boundsType": "OBS_BOUNDS_NONE",

        "cropToBounds": False,

        "cropLeft": 0,
        "cropRight": 0,
        "cropTop": 0,
        "cropBottom": 0,
    }

    try:
        # --------------------------------------------------------
        # CENTER
        # --------------------------------------------------------

        center_transform = {
            **base_transform,
            "positionX": center_x,
        }

        print("=== APPLY CENTER ===")

        apply_transform(
            client,
            scene_item_id,
            center_transform,
        )

        actual = get_transform(
            client,
            scene_item_id,
        )

        print_transform(
            "CENTER RESULT",
            actual,
        )

        center_path = (
            OUTPUT_DIR / "fill_center_fixed.png"
        )

        save_scene_screenshot(
            client,
            center_path,
        )

        print(
            f"Screenshot: {center_path}"
        )
        print()

        # --------------------------------------------------------
        # VIDEO MOVED LEFT
        #
        # This means the actual image moves left.
        # --------------------------------------------------------

        print("=== MOVE VIDEO LEFT ===")
        print(
            f"positionX: "
            f"{left_position_x}"
        )

        left_transform = {
            **base_transform,
            "positionX": left_position_x,
        }

        apply_transform(
            client,
            scene_item_id,
            left_transform,
        )

        actual = get_transform(
            client,
            scene_item_id,
        )

        print_transform(
            "VIDEO LEFT RESULT",
            actual,
        )

        left_path = (
            OUTPUT_DIR / "fill_video_left_fixed.png"
        )

        save_scene_screenshot(
            client,
            left_path,
        )

        print(
            f"Screenshot: {left_path}"
        )
        print()

        # --------------------------------------------------------
        # VIDEO MOVED RIGHT
        # --------------------------------------------------------

        print("=== MOVE VIDEO RIGHT ===")
        print(
            f"positionX: "
            f"{right_position_x}"
        )

        right_transform = {
            **base_transform,
            "positionX": right_position_x,
        }

        apply_transform(
            client,
            scene_item_id,
            right_transform,
        )

        actual = get_transform(
            client,
            scene_item_id,
        )

        print_transform(
            "VIDEO RIGHT RESULT",
            actual,
        )

        right_path = (
            OUTPUT_DIR / "fill_video_right_fixed.png"
        )

        save_scene_screenshot(
            client,
            right_path,
        )

        print(
            f"Screenshot: {right_path}"
        )
        print()

        # --------------------------------------------------------
        # Move back to center
        # --------------------------------------------------------

        apply_transform(
            client,
            scene_item_id,
            center_transform,
        )

        centered = get_transform(
            client,
            scene_item_id,
        )

        print_transform(
            "CENTER AGAIN",
            centered,
        )

        print(
            "Fill + center + pan: SUCCESS"
        )

    finally:
        # --------------------------------------------------------
        # Restore original state.
        #
        # Never send 0x0 bounds when boundsType is NONE.
        # --------------------------------------------------------

        print(
            "=== RESTORING ORIGINAL ==="
        )

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

        if (
            original["boundsType"]
            != "OBS_BOUNDS_NONE"
        ):
            restore["boundsWidth"] = (
                original["boundsWidth"]
            )
            restore["boundsHeight"] = (
                original["boundsHeight"]
            )

        apply_transform(
            client,
            scene_item_id,
            restore,
        )

        restored = get_transform(
            client,
            scene_item_id,
        )

        print_transform(
            "RESTORED",
            restored,
        )

    print()
    print(
        "Fixed Fill + Center + Pan POC: SUCCESS"
    )


if __name__ == "__main__":
    main()