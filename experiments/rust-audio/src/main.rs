//! Standalone offline test. No Discord connection or Core integration.
use afterparty_rust_audio::{FRAME_BYTES, mix_pcm};
use std::hint::black_box;
use std::time::Instant;

fn main() {
    if std::env::args().nth(1).as_deref() != Some("--bench") {
        eprintln!("Usage: afterparty-rust-audio --bench");
        std::process::exit(2);
    }
    let mut first = [0u8; FRAME_BYTES];
    let mut second = [0u8; FRAME_BYTES];
    for pair in first.chunks_exact_mut(2) {
        pair.copy_from_slice(&1000i16.to_le_bytes());
    }
    for pair in second.chunks_exact_mut(2) {
        pair.copy_from_slice(&(-1000i16).to_le_bytes());
    }

    const ITERATIONS: usize = 30_000;
    let started = Instant::now();
    let mut checksum = 0u64;
    for n in 0..ITERATIONS {
        let output = mix_pcm(
            black_box(&first),
            Some(black_box(&second)),
            black_box((n % 100) as f64 / 100.0),
            black_box(85.0),
        )
        .expect("valid synthetic frames");
        checksum = checksum.wrapping_add(output[n % FRAME_BYTES] as u64);
        black_box(&output);
    }
    let seconds = started.elapsed().as_secs_f64().max(f64::EPSILON);
    println!("Experimental Rust PCM mixer only, not end-to-end audio");
    println!("frames={ITERATIONS} seconds={seconds:.4}");
    println!(
        "frames_per_second={:.0} checksum={checksum}",
        ITERATIONS as f64 / seconds
    );
}
