//! Version 1 of the offline mixer worker protocol. See docs/RUST_DEVELOPMENT.md.
//!
//! A worker reads one bounded request, writes and flushes its complete reply,
//! then reads the next request. It never queues or explicitly reads ahead into
//! PCM input. A supplied reader and the operating system may buffer pipe bytes.
use crate::{FRAME_BYTES, mix_pcm};
use std::io::{self, ErrorKind, Read, Write};

pub mod batch;

pub const REQUEST_HEADER_BYTES: usize = 32;
pub const RESPONSE_HEADER_BYTES: usize = 16;
pub const PROTOCOL_VERSION: u8 = 1;

const MAGIC: &[u8; 4] = b"APCM";
const MIX: u8 = 1;
const MIX_RESULT: u8 = 0x81;
const HAS_SECOND_FRAME: u8 = 1;

struct Request {
    id: [u8; 4],
    has_second: bool,
    progress: f64,
    volume: f64,
}

impl Request {
    fn parse(header: &[u8; REQUEST_HEADER_BYTES]) -> io::Result<Self> {
        if &header[..4] != MAGIC {
            return Err(invalid("Invalid request magic"));
        }
        if header[4] != PROTOCOL_VERSION {
            return Err(invalid("Unsupported protocol version"));
        }
        if header[5] != MIX {
            return Err(invalid("Unsupported request opcode"));
        }
        if header[6] & !HAS_SECOND_FRAME != 0 || header[7] != 0 {
            return Err(invalid("Unsupported flags or nonzero reserved byte"));
        }

        let has_second = header[6] == HAS_SECOND_FRAME;
        let length = u32::from_le_bytes(header[12..16].try_into().unwrap());
        let expected_length = if has_second {
            FRAME_BYTES * 2
        } else {
            FRAME_BYTES
        };
        if length != expected_length as u32 {
            return Err(invalid("Payload length does not match fixed PCM frames"));
        }
        let progress = f64::from_le_bytes(header[16..24].try_into().unwrap());
        let volume = f64::from_le_bytes(header[24..32].try_into().unwrap());
        if !progress.is_finite() || !volume.is_finite() {
            return Err(invalid("Mix controls must be finite"));
        }

        Ok(Self {
            id: header[8..12].try_into().unwrap(),
            has_second,
            progress,
            volume,
        })
    }
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, message)
}

fn read_field(reader: &mut impl Read, target: &mut [u8], field: &'static str) -> io::Result<()> {
    reader.read_exact(target).map_err(|error| {
        if error.kind() == ErrorKind::UnexpectedEof {
            io::Error::new(ErrorKind::UnexpectedEof, field)
        } else {
            error
        }
    })
}

// Only EOF before the first byte of a new header is a clean shutdown. Interrupted
// system calls and short reads can occur anywhere on a pipe and are not EOF.
fn read_header<const N: usize>(reader: &mut impl Read, header: &mut [u8; N]) -> io::Result<bool> {
    loop {
        match reader.read(&mut header[..1]) {
            Ok(0) => return Ok(false),
            Ok(_) => break,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    read_field(reader, &mut header[1..], "Truncated request header")?;
    Ok(true)
}

fn flush_reply(writer: &mut impl Write) -> io::Result<()> {
    loop {
        match writer.flush() {
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            result => return result,
        }
    }
}

/// Serve consecutive PCM mix requests until clean EOF or the first error.
///
/// Inputs and outputs use fixed arrays independent of caller-supplied lengths.
/// The function finishes and flushes a reply before reading the next request,
/// so a slow output consumer blocks input processing instead of growing a queue.
/// Malformed input terminates the stream without a reply for that request.
/// Callers must discard a partial reply if an output error terminates the worker.
/// This blocking API does not impose a timeout on an incomplete request.
pub fn serve(reader: &mut impl Read, writer: &mut impl Write) -> io::Result<()> {
    serve_inner(reader, writer, false)
}

/// Offline control condition: validate/transfer the same packets but return A unchanged.
/// This explicit CLI mode is never selected by the normal worker parent.
pub fn serve_echo(reader: &mut impl Read, writer: &mut impl Write) -> io::Result<()> {
    serve_inner(reader, writer, true)
}

fn serve_inner(reader: &mut impl Read, writer: &mut impl Write, echo: bool) -> io::Result<()> {
    let mut header = [0u8; REQUEST_HEADER_BYTES];
    let mut first = [0u8; FRAME_BYTES];
    let mut second = [0u8; FRAME_BYTES];
    let mut response = [0u8; RESPONSE_HEADER_BYTES + FRAME_BYTES];
    response[..4].copy_from_slice(MAGIC);
    response[4] = PROTOCOL_VERSION;
    response[5] = MIX_RESULT;
    response[12..16].copy_from_slice(&(FRAME_BYTES as u32).to_le_bytes());

    while read_header(reader, &mut header)? {
        let request = Request::parse(&header)?;
        read_field(reader, &mut first, "Truncated first PCM frame")?;
        let next = if request.has_second {
            read_field(reader, &mut second, "Truncated second PCM frame")?;
            Some(second.as_slice())
        } else {
            None
        };
        let mixed = if echo {
            first
        } else {
            mix_pcm(&first, next, request.progress, request.volume).map_err(invalid)?
        };
        response[8..12].copy_from_slice(&request.id);
        response[RESPONSE_HEADER_BYTES..].copy_from_slice(&mixed);
        // Submit one bounded packet instead of a standalone 16-byte pipe write.
        // write_all still handles interrupted/short writes; flush precedes input.
        writer.write_all(&response)?;
        flush_reply(writer)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::Cursor;

    fn frame(sample: i16) -> [u8; FRAME_BYTES] {
        let mut data = [0u8; FRAME_BYTES];
        for pair in data.chunks_exact_mut(2) {
            pair.copy_from_slice(&sample.to_le_bytes());
        }
        data
    }

    fn request(id: u32, second: bool, progress: f64, volume: f64) -> Vec<u8> {
        let mut data = Vec::from(*b"APCM\x01\x01\x00\x00");
        data[6] = u8::from(second);
        data.extend_from_slice(&id.to_le_bytes());
        data.extend_from_slice(&((if second { 2 } else { 1 }) * FRAME_BYTES as u32).to_le_bytes());
        data.extend_from_slice(&progress.to_le_bytes());
        data.extend_from_slice(&volume.to_le_bytes());
        data.extend_from_slice(&frame(1001));
        if second {
            data.extend_from_slice(&frame(-1001));
        }
        data
    }

    fn reply(id: u32, sample: i16) -> Vec<u8> {
        let mut data = Vec::from(*b"APCM\x01\x81\x00\x00");
        data.extend_from_slice(&id.to_le_bytes());
        data.extend_from_slice(&(FRAME_BYTES as u32).to_le_bytes());
        data.extend_from_slice(&frame(sample));
        data
    }

    #[test]
    fn empty_input_exits_cleanly_without_output() {
        let mut output = Vec::new();
        serve(&mut io::empty(), &mut output).unwrap();
        assert!(output.is_empty());
    }

    #[test]
    fn echo_control_preserves_validation_ids_and_first_frame_without_mixing() {
        let input = request(73, true, 0.9, 0.0);
        let mut output = Vec::new();
        serve_echo(&mut input.as_slice(), &mut output).unwrap();
        assert_eq!(output, reply(73, 1001));
        let invalid_input = request(73, true, f64::NAN, 0.0);
        assert_eq!(
            serve_echo(&mut invalid_input.as_slice(), &mut Vec::new())
                .unwrap_err()
                .kind(),
            ErrorKind::InvalidData
        );
        assert!(serve_echo(&mut &input[..input.len() - 1], &mut Vec::new()).is_err());
    }

    #[test]
    fn each_reply_is_submitted_as_one_bounded_packet_before_flush() {
        struct PacketWriter {
            output: Vec<u8>,
            writes: usize,
        }
        impl Write for PacketWriter {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                assert_eq!(bytes.len(), RESPONSE_HEADER_BYTES + FRAME_BYTES);
                self.output.extend_from_slice(bytes);
                self.writes += 1;
                Ok(bytes.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut input = request(1, false, 0.0, 100.0);
        input.extend(request(2, true, 1.0, 100.0));
        let mut writer = PacketWriter {
            output: Vec::new(),
            writes: 0,
        };
        serve(&mut input.as_slice(), &mut writer).unwrap();
        assert_eq!(writer.writes, 2);
        assert_eq!(writer.output, [reply(1, 1001), reply(2, -1001)].concat());
    }

    #[test]
    fn requests_preserve_order_and_opaque_ids_with_no_second_frame_leakage() {
        let mut input = request(u32::MAX, true, 1.0, 50.0);
        input.extend(request(0, false, 1.0, 100.0));
        input.extend(request(u32::MAX, false, -10.0, -1.0));
        let mut expected = reply(u32::MAX, -500);
        expected.extend(reply(0, 1001));
        expected.extend(reply(u32::MAX, 0));
        let mut output = Vec::new();
        serve(&mut input.as_slice(), &mut output).unwrap();
        assert_eq!(output, expected);
    }

    struct Fragmented<T> {
        inner: T,
        calls: usize,
        interrupted_flush: bool,
    }

    impl<R: Read> Read for Fragmented<R> {
        fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
            self.calls += 1;
            if self.calls % 3 == 1 {
                return Err(ErrorKind::Interrupted.into());
            }
            let limit = target.len().min(7);
            self.inner.read(&mut target[..limit])
        }
    }

    impl<W: Write> Write for Fragmented<W> {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.calls += 1;
            if self.calls % 3 == 1 {
                return Err(ErrorKind::Interrupted.into());
            }
            self.inner.write(&data[..data.len().min(13)])
        }

        fn flush(&mut self) -> io::Result<()> {
            if !self.interrupted_flush {
                self.interrupted_flush = true;
                return Err(ErrorKind::Interrupted.into());
            }
            self.inner.flush()
        }
    }

    #[test]
    fn short_reads_writes_and_interrupted_calls_preserve_complete_frames() {
        let input = request(17, true, 0.5, 85.0);
        let mut reader = Fragmented {
            inner: input.as_slice(),
            calls: 0,
            interrupted_flush: false,
        };
        let mut writer = Fragmented {
            inner: Vec::new(),
            calls: 0,
            interrupted_flush: false,
        };
        serve(&mut reader, &mut writer).unwrap();
        assert_eq!(writer.inner, reply(17, 0));
        assert!(writer.interrupted_flush);
    }

    #[test]
    fn partial_headers_and_payloads_are_truncation_errors() {
        let input = request(42, true, 0.3, 85.0);
        for length in (1..REQUEST_HEADER_BYTES).chain([
            REQUEST_HEADER_BYTES,
            REQUEST_HEADER_BYTES + 1,
            REQUEST_HEADER_BYTES + FRAME_BYTES - 1,
            REQUEST_HEADER_BYTES + FRAME_BYTES,
            input.len() - 1,
        ]) {
            let mut output = Vec::new();
            let error = serve(&mut &input[..length], &mut output).unwrap_err();
            assert_eq!(error.kind(), ErrorKind::UnexpectedEof, "length={length}");
            assert!(output.is_empty(), "length={length}");
        }
    }

    #[test]
    fn invalid_headers_fail_before_reading_payload_or_allocating_by_length() {
        let valid = request(9, false, 0.0, 100.0);
        let mut invalid_headers = Vec::new();
        for (index, value) in [(0, b'X'), (4, 2), (5, 0x81), (6, 2), (6, 255), (7, 1)] {
            let mut input = valid.clone();
            input[index] = value;
            invalid_headers.push(input);
        }
        for length in [
            0,
            1,
            FRAME_BYTES as u32 - 1,
            FRAME_BYTES as u32 * 2,
            u32::MAX,
        ] {
            let mut input = valid.clone();
            input[12..16].copy_from_slice(&length.to_le_bytes());
            invalid_headers.push(input);
        }
        let mut missing_second = valid.clone();
        missing_second[6] = 1;
        invalid_headers.push(missing_second);
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            invalid_headers.push(request(9, false, value, 100.0));
            invalid_headers.push(request(9, false, 0.0, value));
        }
        for input in invalid_headers {
            let mut reader = Cursor::new(input);
            let mut output = Vec::new();
            assert_eq!(
                serve(&mut reader, &mut output).unwrap_err().kind(),
                ErrorKind::InvalidData
            );
            assert_eq!(reader.position(), REQUEST_HEADER_BYTES as u64);
            assert!(output.is_empty());
        }
    }

    #[test]
    fn malformed_later_request_keeps_only_prior_complete_replies() {
        let mut input = request(1, false, 0.0, 100.0);
        input.extend(request(2, false, 0.0, f64::NAN));
        input.extend(request(3, false, 0.0, 100.0));
        let mut reader = Cursor::new(input);
        let mut output = Vec::new();
        assert_eq!(
            serve(&mut reader, &mut output).unwrap_err().kind(),
            ErrorKind::InvalidData
        );
        assert_eq!(output, reply(1, 1001));
        assert_eq!(
            reader.position(),
            (2 * REQUEST_HEADER_BYTES + FRAME_BYTES) as u64
        );
    }

    struct ObservedReader<'a> {
        inner: Cursor<Vec<u8>>,
        read_position: &'a Cell<usize>,
    }

    impl Read for ObservedReader<'_> {
        fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
            assert!(target.len() <= FRAME_BYTES);
            let count = self.inner.read(target)?;
            self.read_position.set(self.inner.position() as usize);
            Ok(count)
        }
    }

    struct ObservedWriter<'a> {
        output: Vec<u8>,
        read_position: &'a Cell<usize>,
        flushed: usize,
        fail_after: Option<usize>,
        fail_flush: bool,
    }

    impl Write for ObservedWriter<'_> {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            // The next request cannot be read before this reply is flushed.
            assert_eq!(
                self.read_position.get(),
                (self.flushed + 1) * (REQUEST_HEADER_BYTES + FRAME_BYTES)
            );
            if let Some(limit) = self.fail_after {
                if self.output.len() >= limit {
                    return Err(ErrorKind::BrokenPipe.into());
                }
                let count = data.len().min(limit - self.output.len());
                self.output.extend_from_slice(&data[..count]);
                Ok(count)
            } else {
                self.output.extend_from_slice(data);
                Ok(data.len())
            }
        }

        fn flush(&mut self) -> io::Result<()> {
            assert_eq!(
                self.output.len(),
                (self.flushed + 1) * (RESPONSE_HEADER_BYTES + FRAME_BYTES)
            );
            if self.fail_flush {
                return Err(ErrorKind::BrokenPipe.into());
            }
            self.flushed += 1;
            Ok(())
        }
    }

    #[test]
    fn replies_are_flushed_before_next_input_and_output_errors_stop_input() {
        for (fail_after, fail_flush) in [(None, false), (Some(23), false), (None, true)] {
            let mut input = request(1, false, 0.0, 100.0);
            input.extend(request(2, false, 0.0, 100.0));
            let read_position = Cell::new(0);
            let mut reader = ObservedReader {
                inner: Cursor::new(input),
                read_position: &read_position,
            };
            let mut writer = ObservedWriter {
                output: Vec::new(),
                read_position: &read_position,
                flushed: 0,
                fail_after,
                fail_flush,
            };
            let result = serve(&mut reader, &mut writer);
            if fail_after.is_some() || fail_flush {
                assert_eq!(result.unwrap_err().kind(), ErrorKind::BrokenPipe);
                assert_eq!(read_position.get(), REQUEST_HEADER_BYTES + FRAME_BYTES);
            } else {
                result.unwrap();
                assert_eq!(writer.flushed, 2);
                assert_eq!(writer.output, [reply(1, 1001), reply(2, 1001)].concat());
            }
        }
    }

    #[test]
    fn input_errors_do_not_become_clean_eof() {
        struct FailedReader;
        impl Read for FailedReader {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(ErrorKind::ConnectionReset.into())
            }
        }
        let mut output = Vec::new();
        assert_eq!(
            serve(&mut FailedReader, &mut output).unwrap_err().kind(),
            ErrorKind::ConnectionReset
        );
        assert!(output.is_empty());
    }
}
