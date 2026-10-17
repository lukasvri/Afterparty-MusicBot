//! Explicit bounded batch protocol. Version-1 APCM streaming remains unchanged.
use super::{
    FRAME_BYTES, REQUEST_HEADER_BYTES, Request, flush_reply, invalid, read_field, read_header,
};
use std::io::{self, Read, Write};

pub const HEADER_BYTES: usize = 16;
pub const FRAME_REPLY_HEADER_BYTES: usize = 8;
pub const MAX_FRAMES: usize = 8;
pub const MAX_REQUEST_BYTES: usize =
    HEADER_BYTES + MAX_FRAMES * (REQUEST_HEADER_BYTES + 2 * FRAME_BYTES);
pub const MAX_REPLY_BYTES: usize =
    HEADER_BYTES + MAX_FRAMES * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES);

fn parse(header: &[u8; HEADER_BYTES]) -> io::Result<(usize, usize)> {
    if &header[..4] != b"APBT" || header[4] != 1 || header[5] != 1 || header[7] != 0 {
        return Err(invalid("Invalid batch request header"));
    }
    let count = header[6] as usize;
    if !matches!(count, 1 | 4 | 8) {
        return Err(invalid("Batch frame count must be 1, 4 or 8"));
    }
    let bytes = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
    if bytes < count * (REQUEST_HEADER_BYTES + FRAME_BYTES)
        || bytes > count * (REQUEST_HEADER_BYTES + 2 * FRAME_BYTES)
    {
        return Err(invalid("Batch payload length exceeds fixed frame bounds"));
    }
    Ok((count, bytes))
}

/// Validate the complete batch before submitting any reply. Fixed arrays only;
/// one complete reply is flushed before the next batch header is requested.
pub fn serve(reader: &mut impl Read, writer: &mut impl Write) -> io::Result<()> {
    let mut header = [0u8; HEADER_BYTES];
    let mut frame_header = [0u8; REQUEST_HEADER_BYTES];
    let mut first = [0u8; FRAME_BYTES];
    let mut second = [0u8; FRAME_BYTES];
    let mut reply = [0u8; MAX_REPLY_BYTES];
    while read_header(reader, &mut header)? {
        let (count, mut remaining) = parse(&header)?;
        reply[..4].copy_from_slice(b"APBT");
        reply[4] = 1;
        reply[5] = 129;
        reply[6] = count as u8;
        reply[7] = 0;
        reply[8..12].copy_from_slice(&header[8..12]);
        let payload_bytes = count * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES);
        reply[12..16].copy_from_slice(&(payload_bytes as u32).to_le_bytes());
        for index in 0..count {
            if remaining < REQUEST_HEADER_BYTES {
                return Err(invalid("Batch payload cannot contain another frame header"));
            }
            read_field(reader, &mut frame_header, "Truncated batch frame header")?;
            remaining -= REQUEST_HEADER_BYTES;
            let request = Request::parse(&frame_header)?;
            let input_bytes = FRAME_BYTES * if request.has_second { 2 } else { 1 };
            if remaining < input_bytes {
                return Err(invalid("Batch frame exceeds remaining declared payload"));
            }
            read_field(reader, &mut first, "Truncated batch first PCM frame")?;
            let next = if request.has_second {
                read_field(reader, &mut second, "Truncated batch second PCM frame")?;
                Some(second.as_slice())
            } else {
                None
            };
            remaining -= input_bytes;
            let mixed =
                super::mix_pcm(&first, next, request.progress, request.volume).map_err(invalid)?;
            let offset = HEADER_BYTES + index * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES);
            reply[offset..offset + 4].copy_from_slice(&request.id);
            reply[offset + 4..offset + 8].copy_from_slice(&(FRAME_BYTES as u32).to_le_bytes());
            reply[offset + FRAME_REPLY_HEADER_BYTES
                ..offset + FRAME_REPLY_HEADER_BYTES + FRAME_BYTES]
                .copy_from_slice(&mixed);
        }
        if remaining != 0 {
            return Err(invalid("Batch payload has undeclared trailing frame bytes"));
        }
        writer.write_all(&reply[..HEADER_BYTES + payload_bytes])?;
        flush_reply(writer)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::{Cursor, ErrorKind};

    fn request(count: usize, second: bool) -> Vec<u8> {
        let frame_bytes = REQUEST_HEADER_BYTES + FRAME_BYTES * if second { 2 } else { 1 };
        let mut packet = Vec::from(*b"APBT\x01\x01\x00\x00");
        packet[6] = count as u8;
        packet.extend_from_slice(&u32::MAX.to_le_bytes());
        packet.extend_from_slice(&((count * frame_bytes) as u32).to_le_bytes());
        for index in 0..count {
            let mut frame = [0u8; REQUEST_HEADER_BYTES];
            frame[..4].copy_from_slice(b"APCM");
            frame[4] = 1;
            frame[5] = 1;
            frame[6] = u8::from(second);
            frame[8..12].copy_from_slice(&(index as u32).to_le_bytes());
            frame[12..16]
                .copy_from_slice(&((frame_bytes - REQUEST_HEADER_BYTES) as u32).to_le_bytes());
            frame[16..24].copy_from_slice(&0.5f64.to_le_bytes());
            frame[24..32].copy_from_slice(&100f64.to_le_bytes());
            packet.extend_from_slice(&frame);
            for _ in 0..FRAME_BYTES / 2 {
                packet.extend_from_slice(&1001i16.to_le_bytes());
            }
            if second {
                for _ in 0..FRAME_BYTES / 2 {
                    packet.extend_from_slice(&(-1000i16).to_le_bytes());
                }
            }
        }
        packet
    }

    #[test]
    fn exact_counts_ids_and_per_frame_mixing_are_bounded() {
        for count in [1, 4, 8] {
            for second in [false, true] {
                let input = request(count, second);
                assert!(input.len() <= MAX_REQUEST_BYTES);
                let mut output = Vec::new();
                serve(&mut input.as_slice(), &mut output).unwrap();
                assert_eq!(
                    output.len(),
                    HEADER_BYTES + count * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES)
                );
                assert!(output.len() <= MAX_REPLY_BYTES);
                assert_eq!(
                    &output[..8],
                    &[b'A', b'P', b'B', b'T', 1, 129, count as u8, 0]
                );
                assert_eq!(&output[8..12], &u32::MAX.to_le_bytes());
                for index in 0..count {
                    let offset = HEADER_BYTES + index * (FRAME_REPLY_HEADER_BYTES + FRAME_BYTES);
                    assert_eq!(&output[offset..offset + 4], &(index as u32).to_le_bytes());
                    for pair in output[offset + 8..offset + 8 + FRAME_BYTES].chunks_exact(2) {
                        assert_eq!(
                            i16::from_le_bytes(pair.try_into().unwrap()),
                            if second { 1 } else { 1001 }
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn malformed_outer_bounds_are_rejected_before_frame_reads() {
        for (index, value) in [
            (0, b'X'),
            (4, 2),
            (5, 129),
            (6, 0),
            (6, 2),
            (6, 255),
            (7, 1),
        ] {
            let mut input = request(8, true);
            input[index] = value;
            let mut reader = Cursor::new(input);
            let mut output = Vec::new();
            assert_eq!(
                serve(&mut reader, &mut output).unwrap_err().kind(),
                ErrorKind::InvalidData
            );
            assert_eq!(reader.position(), HEADER_BYTES as u64);
            assert!(output.is_empty());
        }
        for length in [0, 1, u32::MAX] {
            let mut input = request(8, true);
            input[12..16].copy_from_slice(&length.to_le_bytes());
            let mut reader = Cursor::new(input);
            assert!(serve(&mut reader, &mut Vec::new()).is_err());
            assert_eq!(reader.position(), HEADER_BYTES as u64);
        }
    }

    #[test]
    fn declared_payload_budget_is_enforced_before_frame_body_reads() {
        let mut too_short = request(1, true);
        too_short[12..16]
            .copy_from_slice(&((REQUEST_HEADER_BYTES + FRAME_BYTES) as u32).to_le_bytes());
        let mut reader = Cursor::new(too_short);
        let mut output = Vec::new();
        assert!(serve(&mut reader, &mut output).is_err());
        assert_eq!(
            reader.position(),
            (HEADER_BYTES + REQUEST_HEADER_BYTES) as u64
        );
        assert!(output.is_empty());

        let mut too_long = request(1, false);
        too_long[12..16]
            .copy_from_slice(&((REQUEST_HEADER_BYTES + 2 * FRAME_BYTES) as u32).to_le_bytes());
        let actual = too_long.len();
        too_long.extend(request(1, false));
        let mut reader = Cursor::new(too_long);
        assert!(serve(&mut reader, &mut output).is_err());
        assert_eq!(
            reader.position(),
            actual as u64,
            "trailing declared bytes must not consume the next batch"
        );
        assert!(output.is_empty());
    }

    #[test]
    fn later_invalid_or_truncated_frame_never_publishes_partial_batch() {
        let valid = request(8, true);
        for length in [1, HEADER_BYTES - 1, HEADER_BYTES, valid.len() - 1] {
            let mut output = Vec::new();
            assert!(serve(&mut &valid[..length], &mut output).is_err());
            assert!(output.is_empty());
        }
        let mut invalid_frame = valid.clone();
        invalid_frame[HEADER_BYTES + 7 * (REQUEST_HEADER_BYTES + 2 * FRAME_BYTES) + 24
            ..HEADER_BYTES + 7 * (REQUEST_HEADER_BYTES + 2 * FRAME_BYTES) + 32]
            .copy_from_slice(&f64::NAN.to_le_bytes());
        let mut output = Vec::new();
        assert!(serve(&mut invalid_frame.as_slice(), &mut output).is_err());
        assert!(output.is_empty());
        let mut input = request(1, false);
        input.extend_from_slice(&invalid_frame);
        assert!(serve(&mut input.as_slice(), &mut output).is_err());
        assert_eq!(
            output.len(),
            HEADER_BYTES + FRAME_REPLY_HEADER_BYTES + FRAME_BYTES
        );
    }

    struct Fragments<T> {
        inner: T,
        calls: usize,
    }
    impl<R: Read> Read for Fragments<R> {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            self.calls += 1;
            if self.calls % 3 == 0 {
                return Err(ErrorKind::Interrupted.into());
            }
            let size = bytes.len().min(11);
            self.inner.read(&mut bytes[..size])
        }
    }
    impl<W: Write> Write for Fragments<W> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.calls += 1;
            if self.calls % 3 == 0 {
                return Err(ErrorKind::Interrupted.into());
            }
            self.inner.write(&bytes[..bytes.len().min(13)])
        }
        fn flush(&mut self) -> io::Result<()> {
            self.inner.flush()
        }
    }
    #[test]
    fn fragmented_and_interrupted_io_preserves_complete_batch() {
        let input = request(8, true);
        let mut expected = Vec::new();
        serve(&mut input.as_slice(), &mut expected).unwrap();
        let mut reader = Fragments {
            inner: input.as_slice(),
            calls: 0,
        };
        let mut writer = Fragments {
            inner: Vec::new(),
            calls: 0,
        };
        serve(&mut reader, &mut writer).unwrap();
        assert_eq!(writer.inner, expected);
    }

    #[test]
    fn next_batch_is_not_read_before_flush_and_output_failure_stops_input() {
        struct Reader<'a> {
            inner: Cursor<Vec<u8>>,
            position: &'a Cell<u64>,
        }
        impl Read for Reader<'_> {
            fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
                let size = self.inner.read(bytes)?;
                self.position.set(self.inner.position());
                Ok(size)
            }
        }
        struct Writer<'a> {
            position: &'a Cell<u64>,
            request_size: u64,
            flushed: usize,
            fail: bool,
        }
        impl Write for Writer<'_> {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                assert_eq!(
                    self.position.get(),
                    (self.flushed as u64 + 1) * self.request_size
                );
                if self.fail {
                    Err(ErrorKind::BrokenPipe.into())
                } else {
                    Ok(bytes.len())
                }
            }
            fn flush(&mut self) -> io::Result<()> {
                self.flushed += 1;
                Ok(())
            }
        }
        for fail in [false, true] {
            let input = request(4, true);
            let size = input.len() as u64;
            let position = Cell::new(0);
            let mut reader = Reader {
                inner: Cursor::new([input.clone(), input].concat()),
                position: &position,
            };
            let mut writer = Writer {
                position: &position,
                request_size: size,
                flushed: 0,
                fail,
            };
            let result = serve(&mut reader, &mut writer);
            if fail {
                assert!(result.is_err());
                assert_eq!(position.get(), size);
            } else {
                result.unwrap();
                assert_eq!(writer.flushed, 2);
            }
        }
    }
}
