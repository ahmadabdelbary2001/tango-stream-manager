use std::fmt;

/// A 2D size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Size {
    pub fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
}

/// A 2D point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// A rectangle in Cartesian screen/preview coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn left(&self) -> f64 {
        self.x
    }

    pub fn top(&self) -> f64 {
        self.y
    }

    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }

    pub fn center(&self) -> Point {
        Point::new(
            self.x + self.width / 2.0,
            self.y + self.height / 2.0,
        )
    }
}

/// User-controlled video transform.
///
/// `pan_x` and `pan_y` are offsets relative to the
/// center of the canvas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VideoTransform {
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
}

impl Default for VideoTransform {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
        }
    }
}

impl VideoTransform {
    pub fn new(
        zoom: f64,
        pan_x: f64,
        pan_y: f64,
    ) -> Self {
        Self {
            zoom,
            pan_x,
            pan_y,
        }
    }
}

/// Result of Fill + Zoom calculations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Geometry {
    pub fill_scale: f64,
    pub effective_scale: f64,
    pub rendered_size: Size,
    pub rendered_rect: Rect,
}

/// A crop rectangle expressed in original-source
/// coordinates.
///
/// These are floating-point values deliberately.
/// OBS integer crop conversion belongs in the OBS adapter.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SourceCrop {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl SourceCrop {
    pub fn width(
        &self,
        source: Size,
    ) -> f64 {
        source.width
            - self.left
            - self.right
    }

    pub fn height(
        &self,
        source: Size,
    ) -> f64 {
        source.height
            - self.top
            - self.bottom
    }
}

/// Mapping result from Preview Crop Frame to source.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropResult {
    pub source_rect: Rect,
    pub crop: SourceCrop,
    pub geometry: Geometry,
}

/// Allowed Pan range.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PanLimits {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

impl PanLimits {
    pub fn clamp(
        &self,
        pan_x: f64,
        pan_y: f64,
    ) -> Point {
        Point::new(
            pan_x.clamp(self.min_x, self.max_x),
            pan_y.clamp(self.min_y, self.max_y),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompositionError {
    InvalidSourceSize,
    InvalidCanvasSize,
    InvalidZoom,
    InvalidCropFrame,
    CropFrameOutsideVideo,
}

impl fmt::Display for CompositionError {
    fn fmt(
        &self,
        f: &mut fmt::Formatter<'_>,
    ) -> fmt::Result {
        match self {
            Self::InvalidSourceSize => {
                write!(f, "source size must be greater than zero")
            }
            Self::InvalidCanvasSize => {
                write!(f, "canvas size must be greater than zero")
            }
            Self::InvalidZoom => {
                write!(f, "zoom must be greater than zero")
            }
            Self::InvalidCropFrame => {
                write!(f, "crop frame must have positive dimensions")
            }
            Self::CropFrameOutsideVideo => {
                write!(
                    f,
                    "crop frame must be completely covered by the rendered video"
                )
            }
        }
    }
}

impl std::error::Error for CompositionError {}

fn validate_size(
    size: Size,
) -> Result<(), CompositionError> {
    if size.width <= 0.0
        || size.height <= 0.0
    {
        return Err(
            CompositionError::InvalidSourceSize
        );
    }

    Ok(())
}

fn validate_canvas(
    canvas: Size,
) -> Result<(), CompositionError> {
    if canvas.width <= 0.0
        || canvas.height <= 0.0
    {
        return Err(
            CompositionError::InvalidCanvasSize
        );
    }

    Ok(())
}

fn validate_crop_frame(
    crop_frame: Rect,
) -> Result<(), CompositionError> {
    if crop_frame.width <= 0.0
        || crop_frame.height <= 0.0
    {
        return Err(
            CompositionError::InvalidCropFrame
        );
    }

    Ok(())
}

/// Calculate the Fill scale needed to cover the canvas
/// while preserving the video's aspect ratio.
pub fn calculate_fill_scale(
    source: Size,
    canvas: Size,
) -> Result<f64, CompositionError> {
    validate_size(source)?;
    validate_canvas(canvas)?;

    Ok(
        (canvas.width / source.width)
            .max(canvas.height / source.height)
    )
}

/// Calculate the complete rendered video geometry.
pub fn calculate_geometry(
    source: Size,
    canvas: Size,
    transform: VideoTransform,
) -> Result<Geometry, CompositionError> {
    let fill_scale =
        calculate_fill_scale(source, canvas)?;

    if transform.zoom <= 0.0 {
        return Err(
            CompositionError::InvalidZoom
        );
    }

    let effective_scale =
        fill_scale * transform.zoom;

    let rendered_size = Size::new(
        source.width * effective_scale,
        source.height * effective_scale,
    );

    let center_x =
        canvas.width / 2.0
            + transform.pan_x;

    let center_y =
        canvas.height / 2.0
            + transform.pan_y;

    let rendered_rect = Rect::new(
        center_x
            - rendered_size.width / 2.0,
        center_y
            - rendered_size.height / 2.0,
        rendered_size.width,
        rendered_size.height,
    );

    Ok(Geometry {
        fill_scale,
        effective_scale,
        rendered_size,
        rendered_rect,
    })
}

/// Convert a Crop Frame in Preview coordinates into
/// the corresponding rectangle in source coordinates.
pub fn preview_to_source(
    source: Size,
    canvas: Size,
    transform: VideoTransform,
    crop_frame: Rect,
) -> Result<CropResult, CompositionError> {
    validate_crop_frame(crop_frame)?;

    let geometry =
        calculate_geometry(
            source,
            canvas,
            transform,
        )?;

    let video =
        geometry.rendered_rect;

    const EPSILON: f64 = 1e-9;

    if crop_frame.left()
        < video.left() - EPSILON
        || crop_frame.right()
            > video.right() + EPSILON
        || crop_frame.top()
            < video.top() - EPSILON
        || crop_frame.bottom()
            > video.bottom() + EPSILON
    {
        return Err(
            CompositionError::CropFrameOutsideVideo
        );
    }

    let source_left =
        ((crop_frame.left() - video.left())
            / geometry.effective_scale)
            .clamp(0.0, source.width);

    let source_top =
        ((crop_frame.top() - video.top())
            / geometry.effective_scale)
            .clamp(0.0, source.height);

    let source_right =
        ((crop_frame.right() - video.left())
            / geometry.effective_scale)
            .clamp(0.0, source.width);

    let source_bottom =
        ((crop_frame.bottom() - video.top())
            / geometry.effective_scale)
            .clamp(0.0, source.height);

    let source_rect = Rect::new(
        source_left,
        source_top,
        source_right - source_left,
        source_bottom - source_top,
    );

    let crop = SourceCrop {
        left: source_left,
        top: source_top,
        right: source.width - source_right,
        bottom: source.height - source_bottom,
    };

    Ok(CropResult {
        source_rect,
        crop,
        geometry,
    })
}

/// Calculate the Pan range that keeps the entire Crop Frame
/// covered by the rendered video.
///
/// Rotation is intentionally not supported here yet.
/// This is the zero-rotation composition engine.
pub fn calculate_pan_limits(
    source: Size,
    canvas: Size,
    crop_frame: Rect,
    zoom: f64,
) -> Result<PanLimits, CompositionError> {
    validate_crop_frame(crop_frame)?;

    if zoom <= 0.0 {
        return Err(
            CompositionError::InvalidZoom
        );
    }

    let fill_scale =
        calculate_fill_scale(source, canvas)?;

    let scale =
        fill_scale * zoom;

    let rendered_width =
        source.width * scale;

    let rendered_height =
        source.height * scale;

    let extra_width =
        rendered_width
            - crop_frame.width;

    let extra_height =
        rendered_height
            - crop_frame.height;

    if extra_width < 0.0
        || extra_height < 0.0
    {
        return Err(
            CompositionError::CropFrameOutsideVideo
        );
    }

    let half_extra_x =
        extra_width / 2.0;

    let half_extra_y =
        extra_height / 2.0;

    let frame_center =
        crop_frame.center();

    let canvas_center =
        Point::new(
            canvas.width / 2.0,
            canvas.height / 2.0,
        );

    let center_delta_x =
        frame_center.x
            - canvas_center.x;

    let center_delta_y =
        frame_center.y
            - canvas_center.y;

    Ok(PanLimits {
        min_x:
            center_delta_x
                - half_extra_x,
        max_x:
            center_delta_x
                + half_extra_x,
        min_y:
            center_delta_y
                - half_extra_y,
        max_y:
            center_delta_y
                + half_extra_y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 0.0001;

    fn assert_close(
        actual: f64,
        expected: f64,
    ) {
        assert!(
            (actual - expected).abs()
                < EPSILON,
            "actual={actual}, expected={expected}"
        );
    }

    fn source() -> Size {
        Size::new(568.0, 762.0)
    }

    fn canvas() -> Size {
        Size::new(720.0, 1280.0)
    }

    fn crop_frame() -> Rect {
        Rect::new(
            180.0,
            160.0,
            360.0,
            640.0,
        )
    }

    #[test]
    fn fill_scale_matches_python_poc() {
        let scale =
            calculate_fill_scale(
                source(),
                canvas(),
            )
            .unwrap();

        assert_close(
            scale,
            1.6797900262467191,
        );
    }

    #[test]
    fn centered_fill_matches_python_poc() {
        let geometry =
            calculate_geometry(
                source(),
                canvas(),
                VideoTransform::default(),
            )
            .unwrap();

        assert_close(
            geometry.effective_scale,
            1.6797900262467191,
        );

        assert_close(
            geometry.rendered_size.width,
            954.1207349081365,
        );

        assert_close(
            geometry.rendered_size.height,
            1280.0,
        );

        assert_close(
            geometry.rendered_rect.x,
            -117.06036745406823,
        );

        assert_close(
            geometry.rendered_rect.y,
            0.0,
        );
    }

    #[test]
    fn zoom_changes_scale_without_distortion() {
        let geometry =
            calculate_geometry(
                source(),
                canvas(),
                VideoTransform::new(
                    1.20,
                    0.0,
                    0.0,
                ),
            )
            .unwrap();

        assert_close(
            geometry.effective_scale,
            2.015748031496063,
        );

        let ratio =
            geometry.rendered_size.width
                / geometry.rendered_size.height;

        let source_ratio =
            source().width
                / source().height;

        assert_close(
            ratio,
            source_ratio,
        );
    }

    #[test]
    fn pan_moves_video_without_changing_size() {
        let centered =
            calculate_geometry(
                source(),
                canvas(),
                VideoTransform::default(),
            )
            .unwrap();

        let panned =
            calculate_geometry(
                source(),
                canvas(),
                VideoTransform::new(
                    1.20,
                    -70.0,
                    25.0,
                ),
            )
            .unwrap();

        assert_close(
            centered.rendered_size.width,
            954.1207349081365,
        );

        assert_close(
            panned.rendered_size.width,
            1144.9448818897638,
        );

        assert_close(
            panned.rendered_rect.center().x,
            290.0,
        );

        assert_close(
            panned.rendered_rect.center().y,
            665.0,
        );
    }

    #[test]
    fn crop_frame_maps_to_source_coordinates() {
        let result =
            preview_to_source(
                source(),
                canvas(),
                VideoTransform::default(),
                crop_frame(),
            )
            .unwrap();

        assert_close(
            result.source_rect.x,
            176.84375,
        );

        assert_close(
            result.source_rect.y,
            95.25,
        );

        assert_close(
            result.source_rect.width,
            214.3125,
        );

        assert_close(
            result.source_rect.height,
            381.0,
        );

        assert_close(
            result.crop.left,
            176.84375,
        );

        assert_close(
            result.crop.right,
            176.84375,
        );

        assert_close(
            result.crop.top,
            95.25,
        );

        assert_close(
            result.crop.bottom,
            285.75,
        );
    }

    #[test]
    fn pan_limits_match_python_poc() {
        let limits =
            calculate_pan_limits(
                source(),
                canvas(),
                crop_frame(),
                1.20,
            )
            .unwrap();

        assert_close(
            limits.min_x,
            -392.4724409448819,
        );

        assert_close(
            limits.max_x,
            392.4724409448819,
        );

        assert_close(
            limits.min_y,
            -608.0,
        );

        assert_close(
            limits.max_y,
            288.0,
        );
    }

    #[test]
    fn pan_clamping_works() {
        let limits =
            calculate_pan_limits(
                source(),
                canvas(),
                crop_frame(),
                1.20,
            )
            .unwrap();

        let clamped =
            limits.clamp(
                9999.0,
                -9999.0,
            );

        assert_close(
            clamped.x,
            limits.max_x,
        );

        assert_close(
            clamped.y,
            limits.min_y,
        );
    }

    #[test]
    fn crop_preserves_requested_preview_aspect_ratio() {
        let result =
            preview_to_source(
                source(),
                canvas(),
                VideoTransform::new(
                    1.20,
                    -70.0,
                    25.0,
                ),
                crop_frame(),
            )
            .unwrap();

        let source_ratio =
            result.source_rect.width
                / result.source_rect.height;

        let frame_ratio =
            crop_frame().width
                / crop_frame().height;

        assert_close(
            source_ratio,
            frame_ratio,
        );
    }
}