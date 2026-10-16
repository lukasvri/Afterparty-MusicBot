//! Isolated PCM mixing prototype. No Discord or production access.
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
        let output = sample.round().clamp(-32768.0, 32767.0) as i16;
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

    #[test]
    fn invalid_inputs_fail_closed() {
        let original = frame(1);
        assert!(mix_pcm(&original[..4], None, 0.0, 100.0).is_err());
        assert!(mix_pcm(&original, Some(&original[..4]), 0.0, 100.0).is_err());
        assert!(mix_pcm(&original, None, f64::NAN, 100.0).is_err());
        assert!(mix_pcm(&original, None, 0.0, f64::INFINITY).is_err());
    }
}
