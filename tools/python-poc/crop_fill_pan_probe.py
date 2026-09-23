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

OUTPUT_DIR = Path(
    r"E:\My Projects\tango-transform-screenshots"
)


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


def calculate_geometry(
    source_width: float,
    source_height: float,
    crop_left: float,
    crop_right: float,
    crop_top: float,
    crop_bottom: float,
) -> dict:

    effective_width = (
        source_width
        - crop_left
        - crop_right
    )

    effective_height = (
        source_height
        - crop_top
        - crop_bottom
    )

    if effective_width <= 0:
        raise ValueError(
            "Horizontal crop removes the entire source."
        )

    if effective_height <= 0:
        raise ValueError(
            "Vertical crop removes the entire source."
        )

    # Fill = cover.
    scale = max(
        CANVAS_WIDTH / effective_width,
        CANVAS_HEIGHT / effective_height,
    )

    rendered_width = effective_width * scale
    rendered_height = effective_height * scale

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

    return {
        "effective_width": effective_width,
        "effective_height": effective_height,
        "scale": scale,
        "rendered_width": rendered_width,
        "rendered_height": rendered_height,
        "overflow_x": overflow_x,
        "overflow_y": overflow_y,
        "max_pan_x": max_pan_x,
        "max_pan_y": max_pan_y,
        "center_x": center_x,
        "center_y": center_y,
    }


def print_geometry(
    name: str,
    geometry: dict,
) -> None:

    print(f"=== {name} GEOMETRY ===")

    for key, value in geometry.items():
        print(f"{key}: {value:.6f}")

    print()


def print_transform(
    name: str,
    transform: dict,
) -> None:

    print(f"=== {name} TRANSFORM ===")

    fields = [
        "positionX",
        "positionY",
        "width",
        "height",
        "sourceWidth",
        "sourceHeight",
        "scaleX",
        "scaleY",
        "alignment",
        "boundsType",
        "cropToBounds",
        "cropLeft",
        "cropRight",
        "cropTop",
        "cropBottom",
    ]

    for field in fields:
        print(
            f"{field}: {transform.get(field)}"
        )

    print()


def almost_equal(
    actual: float,
    expected: float,
    tolerance: float = 1.0,
) -> bool:
    return math.isclose(
        actual,
        expected,
        abs_tol=tolerance,
    )


def main() -> None:

    password = os.environ.get(
        "OBS_WS_PASSWORD"
    )

    if not password:
        fail(
            "OBS_WS_PASSWORD is not set."
        )

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

    print(
        "=== CROP + FILL + PAN POC ==="
    )
    print(f"Scene: {SCENE_NAME}")
    print(f"Input: {INPUT_NAME}")
    print(
        f"Canvas: "
        f"{CANVAS_WIDTH:.0f} x "
        f"{CANVAS_HEIGHT:.0f}"
    )
    print()

    scene_item_id = get_scene_item_id(
        client
    )

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

    tests = [
        {
            "name": "NO_CROP",
            "file": "crop_no_crop.png",
            "cropLeft": 0,
            "cropRight": 0,
            "cropTop": 0,
            "cropBottom": 0,
        },
        {
            "name": "HORIZONTAL_SYMMETRIC",
            "file": "crop_horizontal_symmetric.png",
            "cropLeft": 50,
            "cropRight": 50,
            "cropTop": 0,
            "cropBottom": 0,
        },
        {
            "name": "VERTICAL_SYMMETRIC",
            "file": "crop_vertical_symmetric.png",
            "cropLeft": 0,
            "cropRight": 0,
            "cropTop": 100,
            "cropBottom": 100,
        },
        {
            "name": "ASYMMETRIC_LEFT",
            "file": "crop_asymmetric_left.png",
            "cropLeft": 100,
            "cropRight": 0,
            "cropTop": 0,
            "cropBottom": 0,
        },
    ]

    try:

        for test in tests:

            name = test["name"]

            crop_left = float(
                test["cropLeft"]
            )
            crop_right = float(
                test["cropRight"]
            )
            crop_top = float(
                test["cropTop"]
            )
            crop_bottom = float(
                test["cropBottom"]
            )

            print(
                f"=============================="
            )
            print(
                f"=== APPLY {name} ==="
            )
            print(
                f"cropLeft:   {crop_left}"
            )
            print(
                f"cropRight:  {crop_right}"
            )
            print(
                f"cropTop:    {crop_top}"
            )
            print(
                f"cropBottom: {crop_bottom}"
            )
            print()

            geometry = calculate_geometry(
                source_width,
                source_height,
                crop_left,
                crop_right,
                crop_top,
                crop_bottom,
            )

            print_geometry(
                name,
                geometry,
            )

            transform = {
                # Center the cropped video.
                "positionX": geometry[
                    "center_x"
                ],
                "positionY": geometry[
                    "center_y"
                ],

                "rotation": 0.0,

                # Fill manually.
                "scaleX": geometry[
                    "scale"
                ],
                "scaleY": geometry[
                    "scale"
                ],

                # OBS_ALIGN_CENTER.
                "alignment": 0,

                # No OBS bounds.
                "boundsType":
                    "OBS_BOUNDS_NONE",

                "cropToBounds": False,

                # Actual user crop.
                "cropLeft": int(
                    crop_left
                ),
                "cropRight": int(
                    crop_right
                ),
                "cropTop": int(
                    crop_top
                ),
                "cropBottom": int(
                    crop_bottom
                ),
            }

            apply_transform(
                client,
                scene_item_id,
                transform,
            )

            actual = get_transform(
                client,
                scene_item_id,
            )

            print_transform(
                f"{name} RESULT",
                actual,
            )

            expected_width = (
                geometry[
                    "effective_width"
                ]
                * geometry["scale"]
            )

            expected_height = (
                geometry[
                    "effective_height"
                ]
                * geometry["scale"]
            )

            width_ok = almost_equal(
                float(actual["width"]),
                expected_width,
            )

            height_ok = almost_equal(
                float(actual["height"]),
                expected_height,
            )

            scale_x_ok = almost_equal(
                float(actual["scaleX"]),
                geometry["scale"],
                0.001,
            )

            scale_y_ok = almost_equal(
                float(actual["scaleY"]),
                geometry["scale"],
                0.001,
            )

            crop_ok = (
                actual["cropLeft"]
                == crop_left
                and actual["cropRight"]
                == crop_right
                and actual["cropTop"]
                == crop_top
                and actual["cropBottom"]
                == crop_bottom
            )

            print("=== VALIDATION ===")
            print(
                f"Width:      "
                f"{'PASS' if width_ok else 'FAIL'}"
            )
            print(
                f"Height:     "
                f"{'PASS' if height_ok else 'FAIL'}"
            )
            print(
                f"ScaleX:     "
                f"{'PASS' if scale_x_ok else 'FAIL'}"
            )
            print(
                f"ScaleY:     "
                f"{'PASS' if scale_y_ok else 'FAIL'}"
            )
            print(
                f"Crop:       "
                f"{'PASS' if crop_ok else 'FAIL'}"
            )
            print()

            screenshot_path = (
                OUTPUT_DIR / test["file"]
            )

            save_scene_screenshot(
                client,
                screenshot_path,
            )

            print(
                f"Screenshot: "
                f"{screenshot_path}"
            )
            print()

            # ----------------------------------------------------
            # Test maximum horizontal pan for this cropped source.
            # ----------------------------------------------------

            max_pan_x = geometry[
                "max_pan_x"
            ]

            if max_pan_x > 0:

                left_x = (
                    geometry["center_x"]
                    - max_pan_x
                )

                right_x = (
                    geometry["center_x"]
                    + max_pan_x
                )

                print(
                    "=== PAN LIMITS ==="
                )
                print(
                    f"left X:  {left_x:.6f}"
                )
                print(
                    f"center:  "
                    f"{geometry['center_x']:.6f}"
                )
                print(
                    f"right X: "
                    f"{right_x:.6f}"
                )
                print()

                # Left
                left_transform = {
                    **transform,
                    "positionX": left_x,
                }

                apply_transform(
                    client,
                    scene_item_id,
                    left_transform,
                )

                left_path = (
                    OUTPUT_DIR
                    / f"{name.lower()}_pan_left.png"
                )

                save_scene_screenshot(
                    client,
                    left_path,
                )

                # Right
                right_transform = {
                    **transform,
                    "positionX": right_x,
                }

                apply_transform(
                    client,
                    scene_item_id,
                    right_transform,
                )

                right_path = (
                    OUTPUT_DIR
                    / f"{name.lower()}_pan_right.png"
                )

                save_scene_screenshot(
                    client,
                    right_path,
                )

                print(
                    "Pan screenshots saved."
                )
                print()

    finally:

        print(
            "=== RESTORING ORIGINAL ==="
        )

        restore = {
            "positionX":
                original["positionX"],
            "positionY":
                original["positionY"],
            "rotation":
                original["rotation"],
            "scaleX":
                original["scaleX"],
            "scaleY":
                original["scaleY"],
            "alignment":
                original["alignment"],
            "boundsType":
                original["boundsType"],
            "boundsAlignment":
                original["boundsAlignment"],
            "cropToBounds":
                original["cropToBounds"],
            "cropLeft":
                original["cropLeft"],
            "cropRight":
                original["cropRight"],
            "cropTop":
                original["cropTop"],
            "cropBottom":
                original["cropBottom"],
        }

        if (
            original["boundsType"]
            != "OBS_BOUNDS_NONE"
        ):
            restore[
                "boundsWidth"
            ] = original[
                "boundsWidth"
            ]
            restore[
                "boundsHeight"
            ] = original[
                "boundsHeight"
            ]

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

    print(
        "Crop + Fill + Pan POC: SUCCESS"
    )


if __name__ == "__main__":
    main()