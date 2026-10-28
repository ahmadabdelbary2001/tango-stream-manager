use serde::{Deserialize, Serialize};

use crate::profile::AdaptationConfig;

/// Result action emitted by the adaptive bitrate controller after processing a stream health sample.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AdaptationAction {
    /// Network is stable; hold the current bitrate.
    Hold { current_bitrate_kbps: u32 },
    /// Network congestion or dropped frames detected; decrease bitrate.
    Decrease {
        target_bitrate_kbps: u32,
        reason: String,
    },
    /// Network has remained continuously stable past the cooldown window; safely probe upwards.
    Increase {
        target_bitrate_kbps: u32,
        reason: String,
    },
    /// Congestion continues but bitrate is already at the configured minimum limit.
    AtMinimumCongested {
        current_bitrate_kbps: u32,
        reason: String,
    },
}

/// Conservative, anti-oscillating Adaptive Bitrate Controller.
///
/// It processes metric samples reported by OBS over time:
/// - Uses delta dropped frames over the interval, never lifetime counters.
/// - Incorporates OBS output congestion indicator [0.0..1.0].
/// - Steps down promptly on congestion.
/// - Steps up slowly and only after a sustained stable period (`cooldown_seconds`).
/// - Respects strict minimum and maximum bitrate boundaries.
#[derive(Debug, Clone)]
pub struct AdaptiveBitrateController {
    config: AdaptationConfig,
    current_bitrate_kbps: u32,
    last_skipped_frames: Option<u64>,
    last_total_frames: Option<u64>,
    seconds_stable: u32,
}

impl AdaptiveBitrateController {
    pub fn new(config: AdaptationConfig, initial_bitrate_kbps: u32) -> Self {
        let initial_clamped =
            initial_bitrate_kbps.clamp(config.min_bitrate_kbps, config.max_bitrate_kbps);
        Self {
            config,
            current_bitrate_kbps: initial_clamped,
            last_skipped_frames: None,
            last_total_frames: None,
            seconds_stable: 0,
        }
    }

    pub fn current_bitrate(&self) -> u32 {
        self.current_bitrate_kbps
    }

    /// Process a stream health sample.
    ///
    /// - `skipped_frames`: cumulative skipped frames from OBS
    /// - `total_frames`: cumulative total frames from OBS
    /// - `congestion`: OBS congestion metric (0.0 = none, 1.0 = congested)
    /// - `interval_seconds`: seconds elapsed since previous sample
    pub fn process_sample(
        &mut self,
        skipped_frames: u64,
        total_frames: u64,
        congestion: f32,
        interval_seconds: u32,
    ) -> AdaptationAction {
        if !self.config.enabled {
            return AdaptationAction::Hold {
                current_bitrate_kbps: self.current_bitrate_kbps,
            };
        }

        // Calculate delta dropped frames over this interval
        let delta_skipped = match self.last_skipped_frames {
            Some(prev) => skipped_frames.saturating_sub(prev),
            None => 0,
        };
        let delta_total = match self.last_total_frames {
            Some(prev) => total_frames.saturating_sub(prev),
            None => 0,
        };

        self.last_skipped_frames = Some(skipped_frames);
        self.last_total_frames = Some(total_frames);

        let drop_ratio = if delta_total > 0 {
            delta_skipped as f32 / delta_total as f32
        } else {
            0.0
        };

        // Determine if there is network congestion pressure
        let is_congested = congestion >= self.config.down_congestion_threshold || drop_ratio > 0.03;

        if is_congested {
            self.seconds_stable = 0;

            let reason = if congestion >= self.config.down_congestion_threshold {
                format!(
                    "Congestion reached {:.0}% (threshold: {:.0}%)",
                    congestion * 100.0,
                    self.config.down_congestion_threshold * 100.0
                )
            } else {
                format!(
                    "Frame drop rate reached {:.1}% ({} frames lost in interval)",
                    drop_ratio * 100.0,
                    delta_skipped
                )
            };

            if self.current_bitrate_kbps <= self.config.min_bitrate_kbps {
                return AdaptationAction::AtMinimumCongested {
                    current_bitrate_kbps: self.current_bitrate_kbps,
                    reason,
                };
            }

            let target = self
                .current_bitrate_kbps
                .saturating_sub(self.config.step_down_kbps)
                .max(self.config.min_bitrate_kbps);

            self.current_bitrate_kbps = target;

            return AdaptationAction::Decrease {
                target_bitrate_kbps: target,
                reason,
            };
        }

        // Connection is stable
        self.seconds_stable = self.seconds_stable.saturating_add(interval_seconds);

        if self.seconds_stable >= self.config.cooldown_seconds
            && self.current_bitrate_kbps < self.config.max_bitrate_kbps
        {
            let target = (self.current_bitrate_kbps + self.config.step_up_kbps)
                .min(self.config.max_bitrate_kbps);

            self.current_bitrate_kbps = target;
            self.seconds_stable = 0; // reset cooldown for next step

            return AdaptationAction::Increase {
                target_bitrate_kbps: target,
                reason: format!(
                    "Stable connection sustained for {}s; probing higher quality",
                    self.config.cooldown_seconds
                ),
            };
        }

        AdaptationAction::Hold {
            current_bitrate_kbps: self.current_bitrate_kbps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> AdaptationConfig {
        AdaptationConfig {
            enabled: true,
            min_bitrate_kbps: 800,
            max_bitrate_kbps: 3000,
            step_down_kbps: 400,
            step_up_kbps: 200,
            down_congestion_threshold: 0.25,
            cooldown_seconds: 10,
        }
    }

    #[test]
    fn steps_down_gradually_on_congestion() {
        let mut controller = AdaptiveBitrateController::new(test_config(), 2000);

        // First sample establishes baseline
        let action1 = controller.process_sample(0, 100, 0.0, 3);
        assert_eq!(
            action1,
            AdaptationAction::Hold {
                current_bitrate_kbps: 2000
            }
        );

        // High congestion sample
        let action2 = controller.process_sample(0, 200, 0.50, 3);
        assert_eq!(
            action2,
            AdaptationAction::Decrease {
                target_bitrate_kbps: 1600,
                reason: "Congestion reached 50% (threshold: 25%)".into(),
            }
        );
        assert_eq!(controller.current_bitrate(), 1600);
    }

    #[test]
    fn warns_when_at_minimum_bitrate() {
        let mut controller = AdaptiveBitrateController::new(test_config(), 900);

        // First decrease hits min (800)
        let _ = controller.process_sample(0, 100, 0.0, 3);
        let action1 = controller.process_sample(0, 200, 0.80, 3);
        assert_eq!(
            action1,
            AdaptationAction::Decrease {
                target_bitrate_kbps: 800,
                reason: "Congestion reached 80% (threshold: 25%)".into(),
            }
        );

        // Further congestion emits AtMinimumCongested warning
        let action2 = controller.process_sample(0, 300, 0.80, 3);
        assert_eq!(
            action2,
            AdaptationAction::AtMinimumCongested {
                current_bitrate_kbps: 800,
                reason: "Congestion reached 80% (threshold: 25%)".into(),
            }
        );
    }

    #[test]
    fn increases_slowly_only_after_sustained_stability() {
        let mut controller = AdaptiveBitrateController::new(test_config(), 1000);

        // Baseline initialization (0 seconds elapsed)
        controller.process_sample(0, 100, 0.0, 0);

        // 3 seconds stable -> hold (cooldown is 10s)
        let a1 = controller.process_sample(0, 200, 0.0, 3);
        assert_eq!(
            a1,
            AdaptationAction::Hold {
                current_bitrate_kbps: 1000
            }
        );

        // 6 seconds stable -> hold
        let a2 = controller.process_sample(0, 300, 0.0, 3);
        assert_eq!(
            a2,
            AdaptationAction::Hold {
                current_bitrate_kbps: 1000
            }
        );

        // 9 seconds stable -> hold
        let a3 = controller.process_sample(0, 400, 0.0, 3);
        assert_eq!(
            a3,
            AdaptationAction::Hold {
                current_bitrate_kbps: 1000
            }
        );

        // 12 seconds stable (> 10s cooldown) -> steps up by 200 to 1200
        let a4 = controller.process_sample(0, 500, 0.0, 3);
        assert_eq!(
            a4,
            AdaptationAction::Increase {
                target_bitrate_kbps: 1200,
                reason: "Stable connection sustained for 10s; probing higher quality".into(),
            }
        );
        assert_eq!(controller.current_bitrate(), 1200);

        // Immediately following sample should hold because cooldown was reset
        let a5 = controller.process_sample(0, 600, 0.0, 3);
        assert_eq!(
            a5,
            AdaptationAction::Hold {
                current_bitrate_kbps: 1200
            }
        );
    }

    #[test]
    fn uses_delta_frames_rather_than_lifetime_totals() {
        let mut controller = AdaptiveBitrateController::new(test_config(), 2000);

        // Past stream had 500 dropped frames, but current interval has 0 dropped frames
        controller.process_sample(500, 10000, 0.0, 3);
        let action = controller.process_sample(500, 10100, 0.0, 3);

        // No new dropped frames in current interval, no congestion -> hold
        assert_eq!(
            action,
            AdaptationAction::Hold {
                current_bitrate_kbps: 2000
            }
        );
    }
}
