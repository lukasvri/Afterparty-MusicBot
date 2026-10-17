//! Exercise the actual child process and its stdin/stdout contract.
use afterparty_rust_audio::FRAME_BYTES;
use std::io::Write;
use std::process::{Command, Output, Stdio};

fn run(args: &[&str], input: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_afterparty-rust-audio"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if !input.is_empty() {
        child.stdin.take().unwrap().write_all(input).unwrap();
    }
    // wait_with_output closes any remaining stdin handle, allowing clean EOF.
    child.wait_with_output().unwrap()
}

fn identity_request() -> Vec<u8> {
    let mut data = Vec::from(*b"APCM\x01\x01\x00\x00");
    data.extend_from_slice(&0xfedcba98u32.to_le_bytes());
    data.extend_from_slice(&(FRAME_BYTES as u32).to_le_bytes());
    data.extend_from_slice(&0f64.to_le_bytes());
    data.extend_from_slice(&100f64.to_le_bytes());
    for index in 0..FRAME_BYTES {
        data.push(index as u8);
    }
    data
}

#[test]
fn stream_stdout_contains_only_framed_pcm() {
    let input = identity_request();
    let output = run(&["--stream"], &input);
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(&output.stdout[..8], b"APCM\x01\x81\x00\x00");
    assert_eq!(&output.stdout[8..16], &input[8..16]);
    assert_eq!(&output.stdout[16..], &input[32..]);
}

#[test]
fn empty_stream_is_a_clean_shutdown() {
    let output = run(&["--stream"], &[]);
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
}

#[test]
fn invalid_or_truncated_input_has_no_reply_and_returns_failure() {
    let input = identity_request();
    for input in [b"XPCM".as_slice(), &input[..input.len() - 1]] {
        let output = run(&["--stream"], input);
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .starts_with("PCM stream error:")
        );
    }
}

#[test]
fn unknown_or_extra_arguments_return_usage_without_binary_output() {
    for args in [
        vec![],
        vec!["--unknown"],
        vec!["--stream", "extra"],
        vec!["--bench", "extra"],
    ] {
        let output = run(&args, &[]);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .starts_with("Usage:")
        );
    }
}
