//! Isolated PCM mixing prototype. No Discord or production access.
pub mod stream;

pub const FRAME_BYTES: usize = 3840;

/// Mix one 20 ms, 48 kHz stereo, 16-bit signed little-endian PCM frame.
/// Control values are expected to be finite, as in Core's audio pipeline.
pub fn mix_pcm(
    a: &[u8],
    b: Option<&[u8]>,
    progress: f64,
    volume: f64,
) -> Result<[u8; FRAME_BYTES], &'static str> {
    if a.len() != FRAME_BYTES || b.is_some_and(|other| other.len() != FRAME_BYTES) {
        return Err("PCM frame must contain exactly 3840 bytes");
    }
    if !progress.is_finite() || !volume.is_finite() {
        return Err("Mix controls must be finite");
    }

    let fade = progress.clamp(0.0, 1.0);
    let gain = (volume / 100.0).clamp(0.0, 1.0);
    let mut out = [0u8; FRAME_BYTES];
    if b.is_none() && gain == 1.0 {
        out.copy_from_slice(a);
        return Ok(out);
    }
    if gain == 0.0 {
        return Ok(out);
    }

    for i in (0..FRAME_BYTES).step_by(2) {
        let first = i16::from_le_bytes([a[i], a[i + 1]]) as f64;
        let sample = if let Some(second) = b {
            let next = i16::from_le_bytes([second[i], second[i + 1]]) as f64;
            (first * (1.0 - fade) + next * fade) * gain
        } else {
            first * gain
        };
        // Match Core's Math.round: ties go toward positive infinity.
        // Adding 0.5 first can round a value just below a tie up to the tie.
        let lower = sample.floor();
        let rounded = if sample - lower < 0.5 {
            lower
        } else {
            lower + 1.0
        };
        let output = rounded.clamp(-32768.0, 32767.0) as i16;
        out[i..i + 2].copy_from_slice(&output.to_le_bytes());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(sample: i16) -> [u8; FRAME_BYTES] {
        let mut data = [0u8; FRAME_BYTES];
        for pair in data.chunks_exact_mut(2) {
            pair.copy_from_slice(&sample.to_le_bytes());
        }
        data
    }

    fn first_sample(data: &[u8]) -> i16 {
        i16::from_le_bytes([data[0], data[1]])
    }

    #[test]
    fn unity_gain_preserves_samples() {
        let original = frame(-12345);
        assert_eq!(mix_pcm(&original, None, 0.0, 100.0).unwrap(), original);
    }

    #[test]
    fn mute_returns_silence() {
        assert_eq!(
            mix_pcm(&frame(32767), None, 0.0, 0.0).unwrap(),
            [0u8; FRAME_BYTES]
        );
    }

    #[test]
    fn volume_uses_signed_pcm() {
        assert_eq!(
            first_sample(&mix_pcm(&frame(-1000), None, 0.0, 50.0).unwrap()),
            -500
        );
    }

    #[test]
    fn crossfade_matches_endpoints_and_midpoint() {
        let first = frame(1000);
        let second = frame(-1000);
        assert_eq!(
            first_sample(&mix_pcm(&first, Some(&second), 0.0, 100.0).unwrap()),
            1000
        );
        assert_eq!(
            first_sample(&mix_pcm(&first, Some(&second), 0.5, 100.0).unwrap()),
            0
        );
        assert_eq!(
            first_sample(&mix_pcm(&first, Some(&second), 1.0, 100.0).unwrap()),
            -1000
        );
    }

    #[test]
    fn controls_are_clamped() {
        assert_eq!(
            first_sample(&mix_pcm(&frame(16000), Some(&frame(-16000)), 2.0, 150.0).unwrap()),
            -16000
        );
        assert_eq!(
            first_sample(&mix_pcm(&frame(16000), None, 0.0, -10.0).unwrap()),
            0
        );
    }

    // Expected PCM values follow Core's Math.round: halfway values go toward
    // positive infinity. Compare entire frames, including the final sample.
    #[test]
    fn volume_ties_match_core() {
        for (input, expected) in [
            (1001, 501),
            (-1001, -500),
            (1, 1),
            (-1, 0),
            (32767, 16384),
            (-32767, -16383),
            (-32768, -16384),
        ] {
            assert_eq!(
                mix_pcm(&frame(input), None, 0.0, 50.0).unwrap(),
                frame(expected)
            );
        }
    }

    #[test]
    fn volume_near_ties_match_core() {
        for (volume, positive, negative) in [
            (49.99999999999999, 0, 0),
            (50.0, 1, 0),
            (50.00000000000001, 1, -1),
        ] {
            assert_eq!(
                mix_pcm(&frame(1), None, 0.0, volume).unwrap(),
                frame(positive)
            );
            assert_eq!(
                mix_pcm(&frame(-1), None, 0.0, volume).unwrap(),
                frame(negative)
            );
        }
    }

    #[test]
    fn crossfade_ties_and_adjacent_floats_match_core() {
        let below = f64::from_bits(0.5_f64.to_bits() - 1);
        let above = f64::from_bits(0.5_f64.to_bits() + 1);
        for (progress, positive, negative) in [(below, 0, 0), (0.5, 1, 0), (above, 1, -1)] {
            assert_eq!(
                mix_pcm(&frame(0), Some(&frame(1)), progress, 100.0).unwrap(),
                frame(positive)
            );
            assert_eq!(
                mix_pcm(&frame(0), Some(&frame(-1)), progress, 100.0).unwrap(),
                frame(negative)
            );
        }
        for (first, second, expected) in [
            (1000, 1001, 1001),
            (-1000, -1001, -1000),
            (-32768, 32767, 0),
        ] {
            assert_eq!(
                mix_pcm(&frame(first), Some(&frame(second)), 0.5, 100.0).unwrap(),
                frame(expected)
            );
        }
    }

    #[test]
    fn pcm_boundaries_and_control_clamping_match_core() {
        let mut original = [0; FRAME_BYTES];
        let samples = [i16::MIN, i16::MAX, -1, 0, 1];
        for (index, pair) in original.chunks_exact_mut(2).enumerate() {
            pair.copy_from_slice(&samples[index % samples.len()].to_le_bytes());
        }
        for volume in [100.0, 150.0] {
            assert_eq!(mix_pcm(&original, None, 0.0, volume).unwrap(), original);
            assert_eq!(
                mix_pcm(&original, Some(&frame(0)), -1.0, volume).unwrap(),
                original
            );
            assert_eq!(
                mix_pcm(&frame(0), Some(&original), 2.0, volume).unwrap(),
                original
            );
        }
        for volume in [0.0, -10.0] {
            assert_eq!(mix_pcm(&original, None, 0.0, volume).unwrap(), frame(0));
            assert_eq!(
                mix_pcm(&original, Some(&original), 0.5, volume).unwrap(),
                frame(0)
            );
        }
    }

    #[test]
    fn invalid_inputs_fail_closed() {
        let original = frame(1);
        assert!(mix_pcm(&original[..4], None, 0.0, 100.0).is_err());
        assert!(mix_pcm(&original, Some(&original[..4]), 0.0, 100.0).is_err());
        assert!(mix_pcm(&original, None, f64::NAN, 100.0).is_err());
        assert!(mix_pcm(&original, None, 0.0, f64::INFINITY).is_err());
    }
}
