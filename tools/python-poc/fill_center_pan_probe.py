import json
import math
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


def calculate_fill_geometry(
    source_width: float,
    source_height: float,
    canvas_width: float,
    canvas_height: float,
) -> dict:
    """
    OBS SCALE_OUTER:
    scale = max(canvas_width/source_width,
                canvas_height/source_height)
    """

    scale = max(
        canvas_width / source_width,
        canvas_height / source_height,
    )

    rendered_width = source_width * scale
    rendered_height = source_height * scale

    overflow_x = max(0.0, rendered_width - canvas_width)
    overflow_y = max(0.0, rendered_height - canvas_height)

    max_pan_x = overflow_x / 2.0
    max_pan_y = overflow_y / 2.0

    return {
        "scale": scale,
        "rendered_width": rendered_width,
        "rendered_height": rendered_height,
        "overflow_x": overflow_x,
        "overflow_y": overflow_y,
        "max_pan_x": max_pan_x,
        "max_pan_y": max_pan_y,
    }


def print_geometry(geometry: dict) -> None:
    print("=== FILL GEOMETRY ===")

    for key, value in geometry.items():
        print(f"{key}: {value:.6f}")

    print()


def print_transform_summary(name: str, transform: dict) -> None:
    print(f"=== {name} TRANSFORM ===")

    fields = [
        "positionX",
        "positionY",
        "rotation",
        "scaleX",
        "scaleY",
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

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    client = obs.ReqClient(
        host=HOST,
        port=PORT,
        password=password,
        timeout=5,
    )

    print("=== FILL + CENTER + PAN POC ===")
    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print(f"Canvas: {CANVAS_WIDTH:.0f} x {CANVAS_HEIGHT:.0f}")
    print()

    scene_item_id = get_scene_item_id(client)

    original = get_transform(client, scene_item_id)

    print("=== ORIGINAL TRANSFORM ===")
    print(json.dumps(original, indent=2))
    print()

    source_width = float(original["sourceWidth"])
    source_height = float(original["sourceHeight"])

    print(
        f"Source dimensions: "
        f"{source_width:.0f} x {source_height:.0f}"
    )
    print()

    geometry = calculate_fill_geometry(
        source_width,
        source_height,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
    )

    print_geometry(geometry)

    center_x = CANVAS_WIDTH / 2.0
    center_y = CANVAS_HEIGHT / 2.0

    max_pan_x = geometry["max_pan_x"]
    max_pan_y = geometry["max_pan_y"]

    print("=== CENTER POSITION ===")
    print(f"centerX: {center_x:.6f}")
    print(f"centerY: {center_y:.6f}")
    print()

    # OBS_ALIGN_CENTER = 0
    #
    # positionX/Y therefore represent the center point
    # of the scene item.
    #
    # boundsAlignment = 0 means the source is centered
    # inside its bounding rectangle.

    try:
        # --------------------------------------------------------
        # 1. Centered Fill
        # --------------------------------------------------------

        center_transform = {
            "positionX": center_x,
            "positionY": center_y,
            "rotation": 0.0,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "alignment": 0,
            "boundsType": "OBS_BOUNDS_SCALE_OUTER",
            "boundsAlignment": 0,
            "boundsWidth": CANVAS_WIDTH,
            "boundsHeight": CANVAS_HEIGHT,
            "cropToBounds": True,
            "cropLeft": 0,
            "cropRight": 0,
            "cropTop": 0,
            "cropBottom": 0,
        }

        print("=== APPLY CENTER ===")

        apply_transform(
            client,
            scene_item_id,
            center_transform,
        )

        center_actual = get_transform(
            client,
            scene_item_id,
        )

        print_transform_summary(
            "CENTER",
            center_actual,
        )

        center_screenshot = (
            OUTPUT_DIR / "fill_center.png"
        )

        save_scene_screenshot(
            client,
            center_screenshot,
        )

        print(
            f"Screenshot: {center_screenshot}"
        )
        print()

        # --------------------------------------------------------
        # 2. Maximum left pan
        # --------------------------------------------------------

        left_x = center_x - max_pan_x

        left_transform = {
            **center_transform,
            "positionX": left_x,
        }

        print("=== APPLY LEFT PAN ===")
        print(f"positionX: {left_x:.6f}")

        apply_transform(
            client,
            scene_item_id,
            left_transform,
        )

        left_actual = get_transform(
            client,
            scene_item_id,
        )

        print_transform_summary(
            "LEFT PAN",
            left_actual,
        )

        left_screenshot = (
            OUTPUT_DIR / "fill_pan_left.png"
        )

        save_scene_screenshot(
            client,
            left_screenshot,
        )

        print(
            f"Screenshot: {left_screenshot}"
        )
        print()

        # --------------------------------------------------------
        # 3. Maximum right pan
        # --------------------------------------------------------

        right_x = center_x + max_pan_x

        right_transform = {
            **center_transform,
            "positionX": right_x,
        }

        print("=== APPLY RIGHT PAN ===")
        print(f"positionX: {right_x:.6f}")

        apply_transform(
            client,
            scene_item_id,
            right_transform,
        )

        right_actual = get_transform(
            client,
            scene_item_id,
        )

        print_transform_summary(
            "RIGHT PAN",
            right_actual,
        )

        right_screenshot = (
            OUTPUT_DIR / "fill_pan_right.png"
        )

        save_scene_screenshot(
            client,
            right_screenshot,
        )

        print(
            f"Screenshot: {right_screenshot}"
        )
        print()

        # --------------------------------------------------------
        # 4. Test vertical limits
        # --------------------------------------------------------

        print("=== PAN LIMITS ===")
        print(
            f"X: {-max_pan_x:.6f} .. "
            f"{max_pan_x:.6f} relative to center"
        )
        print(
            f"Y: {-max_pan_y:.6f} .. "
            f"{max_pan_y:.6f} relative to center"
        )
        print()

        # --------------------------------------------------------
        # 5. Return to center before restoring
        # --------------------------------------------------------

        apply_transform(
            client,
            scene_item_id,
            center_transform,
        )

        centered_again = get_transform(
            client,
            scene_item_id,
        )

        print_transform_summary(
            "CENTER AGAIN",
            centered_again,
        )

        print(
            "Center + pan operations: SUCCESS"
        )

    finally:
        # --------------------------------------------------------
        # Restore original transform.
        #
        # Do not send boundsWidth/Height when boundsType NONE.
        # --------------------------------------------------------

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

        if original["boundsType"] != "OBS_BOUNDS_NONE":
            restore["boundsWidth"] = original["boundsWidth"]
            restore["boundsHeight"] = original["boundsHeight"]

        apply_transform(
            client,
            scene_item_id,
            restore,
        )

        restored = get_transform(
            client,
            scene_item_id,
        )

        print_transform_summary(
            "RESTORED",
            restored,
        )

    print("Fill + Center + Pan POC: SUCCESS")


if __name__ == "__main__":
    main()