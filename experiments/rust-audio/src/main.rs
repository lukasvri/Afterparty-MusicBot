//! Standalone offline test. No Discord connection or Core integration.
use afterparty_rust_audio::{FRAME_BYTES, mix_pcm, stream};
use std::hint::black_box;
use std::io;
use std::process::ExitCode;
use std::time::Instant;

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    match (args.next(), args.next()) {
        (Some(mode), None) if mode == "--bench" => {
            bench();
            ExitCode::SUCCESS
        }
        (Some(mode), None) if mode == "--stream" || mode == "--echo-stream" => {
            let input = io::stdin();
            let output = io::stdout();
            let result = if mode == "--echo-stream" {
                stream::serve_echo(&mut input.lock(), &mut output.lock())
            } else {
                stream::serve(&mut input.lock(), &mut output.lock())
            };
            match result {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("PCM stream error: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("Usage: afterparty-rust-audio --bench | --stream | --echo-stream");
            ExitCode::from(2)
        }
    }
}

fn bench() {
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
