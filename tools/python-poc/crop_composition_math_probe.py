from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction


@dataclass(frozen=True)
class Size:
    width: float
    height: float


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float

    @property
    def left(self) -> float:
        return self.x

    @property
    def top(self) -> float:
        return self.y

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def center(self) -> Point:
        return Point(
            self.x + self.width / 2.0,
            self.y + self.height / 2.0,
        )


@dataclass(frozen=True)
class VideoTransform:
    zoom: float
    pan_x: float
    pan_y: float


@dataclass(frozen=True)
class FillGeometry:
    fill_scale: float
    effective_scale: float
    rendered_size: Size
    rendered_rect: Rect


@dataclass(frozen=True)
class SourceCrop:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height


@dataclass(frozen=True)
class CropResult:
    frame: Rect
    source_rect: Rect
    crop: SourceCrop
    zoom: float
    pan_x: float
    pan_y: float
    effective_scale: float


CANVAS = Size(
    width=720.0,
    height=1280.0,
)

SOURCE = Size(
    width=568.0,
    height=762.0,
)


def simplify_ratio(
    width: float,
    height: float,
) -> tuple[int, int]:
    """
    Convert a pixel ratio such as 720x1280 into
    its simplest integer ratio.
    """

    width_i = round(width)
    height_i = round(height)

    fraction = Fraction(
        width_i,
        height_i,
    )

    return (
        fraction.numerator,
        fraction.denominator,
    )


def calculate_fill_scale(
    source: Size,
    canvas: Size,
) -> float:
    return max(
        canvas.width / source.width,
        canvas.height / source.height,
    )


def calculate_geometry(
    source: Size,
    canvas: Size,
    transform: VideoTransform,
) -> FillGeometry:

    fill_scale = calculate_fill_scale(
        source,
        canvas,
    )

    effective_scale = (
        fill_scale * transform.zoom
    )

    rendered_size = Size(
        width=source.width * effective_scale,
        height=source.height * effective_scale,
    )

    center_x = (
        canvas.width / 2.0
        + transform.pan_x
    )

    center_y = (
        canvas.height / 2.0
        + transform.pan_y
    )

    rendered_rect = Rect(
        x=center_x - rendered_size.width / 2.0,
        y=center_y - rendered_size.height / 2.0,
        width=rendered_size.width,
        height=rendered_size.height,
    )

    return FillGeometry(
        fill_scale=fill_scale,
        effective_scale=effective_scale,
        rendered_size=rendered_size,
        rendered_rect=rendered_rect,
    )


def calculate_crop(
    source: Size,
    canvas: Size,
    transform: VideoTransform,
    crop_frame: Rect,
) -> CropResult:

    geometry = calculate_geometry(
        source,
        canvas,
        transform,
    )

    video = geometry.rendered_rect

    # ------------------------------------------
    # Validate that Crop Frame is covered
    # completely by the video.
    # ------------------------------------------

    if crop_frame.left < video.left:
        raise ValueError(
            "Crop frame extends beyond "
            "the left side of the video."
        )

    if crop_frame.right > video.right:
        raise ValueError(
            "Crop frame extends beyond "
            "the right side of the video."
        )

    if crop_frame.top < video.top:
        raise ValueError(
            "Crop frame extends beyond "
            "the top of the video."
        )

    if crop_frame.bottom > video.bottom:
        raise ValueError(
            "Crop frame extends beyond "
            "the bottom of the video."
        )

    # ------------------------------------------
    # Preview coordinates -> Source coordinates
    # ------------------------------------------

    source_left = (
        crop_frame.left - video.left
    ) / geometry.effective_scale

    source_top = (
        crop_frame.top - video.top
    ) / geometry.effective_scale

    source_right = (
        crop_frame.right - video.left
    ) / geometry.effective_scale

    source_bottom = (
        crop_frame.bottom - video.top
    ) / geometry.effective_scale

    # Clamp against source bounds.
    source_left = max(
        0.0,
        min(source.width, source_left),
    )

    source_top = max(
        0.0,
        min(source.height, source_top),
    )

    source_right = max(
        0.0,
        min(source.width, source_right),
    )

    source_bottom = max(
        0.0,
        min(source.height, source_bottom),
    )

    source_rect = Rect(
        x=source_left,
        y=source_top,
        width=source_right - source_left,
        height=source_bottom - source_top,
    )

    crop = SourceCrop(
        left=source_left,
        top=source_top,
        right=source_right,
        bottom=source_bottom,
    )

    return CropResult(
        frame=crop_frame,
        source_rect=source_rect,
        crop=crop,
        zoom=transform.zoom,
        pan_x=transform.pan_x,
        pan_y=transform.pan_y,
        effective_scale=geometry.effective_scale,
    )


def calculate_pan_limits(
    source: Size,
    canvas: Size,
    crop_frame: Rect,
    zoom: float,
) -> tuple[float, float, float, float]:

    fill_scale = calculate_fill_scale(
        source,
        canvas,
    )

    scale = fill_scale * zoom

    rendered_width = (
        source.width * scale
    )

    rendered_height = (
        source.height * scale
    )

    frame_center = crop_frame.center

    video_center_x = canvas.width / 2.0
    video_center_y = canvas.height / 2.0

    half_extra_x = (
        rendered_width - crop_frame.width
    ) / 2.0

    half_extra_y = (
        rendered_height - crop_frame.height
    ) / 2.0

    if half_extra_x < 0:
        raise ValueError(
            "Zoom is too small horizontally: "
            "video cannot completely cover Crop Frame."
        )

    if half_extra_y < 0:
        raise ValueError(
            "Zoom is too small vertically: "
            "video cannot completely cover Crop Frame."
        )

    center_delta_x = (
        frame_center.x - video_center_x
    )

    center_delta_y = (
        frame_center.y - video_center_y
    )

    min_pan_x = (
        center_delta_x - half_extra_x
    )

    max_pan_x = (
        center_delta_x + half_extra_x
    )

    min_pan_y = (
        center_delta_y - half_extra_y
    )

    max_pan_y = (
        center_delta_y + half_extra_y
    )

    return (
        min_pan_x,
        max_pan_x,
        min_pan_y,
        max_pan_y,
    )


def print_result(
    name: str,
    result: CropResult,
) -> None:

    print("=" * 60)
    print(name)
    print("=" * 60)

    print(
        f"Crop Frame: "
        f"x={result.frame.x:.4f}, "
        f"y={result.frame.y:.4f}, "
        f"w={result.frame.width:.4f}, "
        f"h={result.frame.height:.4f}"
    )

    print(
        f"Zoom: {result.zoom:.4f}"
    )

    print(
        f"Pan: "
        f"x={result.pan_x:.4f}, "
        f"y={result.pan_y:.4f}"
    )

    print(
        f"Effective scale: "
        f"{result.effective_scale:.8f}"
    )

    print(
        "Source rectangle:"
    )

    print(
        f"  left   = {result.source_rect.left:.4f}"
    )

    print(
        f"  top    = {result.source_rect.top:.4f}"
    )

    print(
        f"  right  = {result.source_rect.right:.4f}"
    )

    print(
        f"  bottom = {result.source_rect.bottom:.4f}"
    )

    print(
        f"Source crop size: "
        f"{result.crop.width:.4f} × "
        f"{result.crop.height:.4f}"
    )

    print(
        f"Crop aspect ratio: "
        f"{result.crop.aspect_ratio:.8f}"
    )

    ratio = simplify_ratio(
        result.crop.width,
        result.crop.height,
    )

    print(
        f"Simplified ratio: "
        f"{ratio[0]}:{ratio[1]}"
    )

    print(
        "OBS crop:"
    )

    print(
        f"  cropLeft   = "
        f"{round(result.crop.left)}"
    )

    print(
        f"  cropTop    = "
        f"{round(result.crop.top)}"
    )

    print(
        f"  cropRight  = "
        f"{round(SOURCE.width - result.crop.right)}"
    )

    print(
        f"  cropBottom = "
        f"{round(SOURCE.height - result.crop.bottom)}"
    )

    print()


def main() -> None:

    print(
        "=== CROP COMPOSITION MATH POC ==="
    )

    print(
        f"Source: "
        f"{SOURCE.width:.0f} × "
        f"{SOURCE.height:.0f}"
    )

    print(
        f"Canvas: "
        f"{CANVAS.width:.0f} × "
        f"{CANVAS.height:.0f}"
    )

    source_ratio = simplify_ratio(
        SOURCE.width,
        SOURCE.height,
    )

    canvas_ratio = simplify_ratio(
        CANVAS.width,
        CANVAS.height,
    )

    print(
        f"Source ratio: "
        f"{source_ratio[0]}:"
        f"{source_ratio[1]}"
    )

    print(
        f"Canvas ratio: "
        f"{canvas_ratio[0]}:"
        f"{canvas_ratio[1]}"
    )

    print()

    # ----------------------------------------------------------
    # Crop frame:
    #
    # Keep it smaller than the entire preview so the user can
    # visually see the video around it.
    #
    # 9:16 ratio.
    # ----------------------------------------------------------

    crop_frame = Rect(
        x=180.0,
        y=160.0,
        width=360.0,
        height=640.0,
    )

    crop_ratio = simplify_ratio(
        crop_frame.width,
        crop_frame.height,
    )

    print(
        f"Crop frame ratio: "
        f"{crop_ratio[0]}:"
        f"{crop_ratio[1]}"
    )

    print()

    # ----------------------------------------------------------
    # TEST 1
    # Fill + Center + no extra zoom/pan
    # ----------------------------------------------------------

    result_1 = calculate_crop(
        source=SOURCE,
        canvas=CANVAS,
        transform=VideoTransform(
            zoom=1.0,
            pan_x=0.0,
            pan_y=0.0,
        ),
        crop_frame=crop_frame,
    )

    print_result(
        "TEST 1 - Fill + Center",
        result_1,
    )

    # ----------------------------------------------------------
    # TEST 2
    # Fill + Zoom
    # ----------------------------------------------------------

    result_2 = calculate_crop(
        source=SOURCE,
        canvas=CANVAS,
        transform=VideoTransform(
            zoom=1.20,
            pan_x=0.0,
            pan_y=0.0,
        ),
        crop_frame=crop_frame,
    )

    print_result(
        "TEST 2 - Fill + Zoom 1.20",
        result_2,
    )

    # ----------------------------------------------------------
    # TEST 3
    # Fill + Zoom + Pan
    # ----------------------------------------------------------

    result_3 = calculate_crop(
        source=SOURCE,
        canvas=CANVAS,
        transform=VideoTransform(
            zoom=1.20,
            pan_x=-70.0,
            pan_y=25.0,
        ),
        crop_frame=crop_frame,
    )

    print_result(
        "TEST 3 - Fill + Zoom + Pan",
        result_3,
    )

    # ----------------------------------------------------------
    # PAN LIMITS
    # ----------------------------------------------------------

    print("=" * 60)
    print("=== PAN LIMITS ===")
    print("=" * 60)

    (
        min_pan_x,
        max_pan_x,
        min_pan_y,
        max_pan_y,
    ) = calculate_pan_limits(
        source=SOURCE,
        canvas=CANVAS,
        crop_frame=crop_frame,
        zoom=1.20,
    )

    print(
        f"Pan X: "
        f"{min_pan_x:.4f} .. "
        f"{max_pan_x:.4f}"
    )

    print(
        f"Pan Y: "
        f"{min_pan_y:.4f} .. "
        f"{max_pan_y:.4f}"
    )

    print()

    # ----------------------------------------------------------
    # TEST 4
    # Maximum allowed left
    # ----------------------------------------------------------

    result_4 = calculate_crop(
        source=SOURCE,
        canvas=CANVAS,
        transform=VideoTransform(
            zoom=1.20,
            pan_x=min_pan_x,
            pan_y=0.0,
        ),
        crop_frame=crop_frame,
    )

    print_result(
        "TEST 4 - Maximum Left Pan",
        result_4,
    )

    # ----------------------------------------------------------
    # TEST 5
    # Maximum allowed right
    # ----------------------------------------------------------

    result_5 = calculate_crop(
        source=SOURCE,
        canvas=CANVAS,
        transform=VideoTransform(
            zoom=1.20,
            pan_x=max_pan_x,
            pan_y=0.0,
        ),
        crop_frame=crop_frame,
    )

    print_result(
        "TEST 5 - Maximum Right Pan",
        result_5,
    )

    print(
        "=" * 60
    )

    print(
        "Crop composition math: SUCCESS"
    )


if __name__ == "__main__":
    main()