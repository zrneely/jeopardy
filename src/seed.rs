use std::{convert::TryInto, fmt, str::FromStr};

#[derive(Debug)]
pub struct Seed {
    value: u32,
}
impl Seed {
    const ALPHABET_SIZE: usize = memorable_wordlist::WORDS.len();
    const VALUE_BITS: usize = 8 * std::mem::size_of::<u32>();

    pub const fn with_seed(value: u32) -> Self {
        Self { value }
    }

    pub fn new_random() -> Self {
        use rand::Rng;

        Self {
            value: rand::thread_rng().gen(),
        }
    }

    fn to_seed(&self) -> [u8; 32] {
        let bytes = self.value.to_le_bytes();
        let mut result = [0xFD; 32];
        result[0..4].copy_from_slice(&bytes);
        result
    }

    pub fn to_rng(&self) -> impl rand::Rng {
        use rand::SeedableRng;
        rand_chacha::ChaCha20Rng::from_seed(self.to_seed())
    }
}
impl fmt::Display for Seed {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let bits_per_digit: usize = (Self::ALPHABET_SIZE as f64).log2().floor() as usize;
        let bitmask: u32 = (1usize.checked_shl(bits_per_digit as u32).unwrap() - 1)
            .try_into()
            .unwrap();

        let mut words = Vec::new();
        let mut cur_offset = 0;
        while cur_offset < Self::VALUE_BITS {
            let index = (self.value.checked_shr(cur_offset as u32).unwrap() & bitmask) as usize;
            cur_offset += bits_per_digit;

            words.push(memorable_wordlist::WORDS[index]);
        }

        write!(f, "{}", words.as_slice().join(" "))
    }
}
impl FromStr for Seed {
    type Err = ();

    fn from_str<'a>(value: &'a str) -> Result<Self, ()> {
        let bits_per_digit: usize = (Self::ALPHABET_SIZE as f64).log2().floor() as usize;

        let parts: Vec<&'a str> = value.split_whitespace().collect();
        if parts.len() * bits_per_digit < Self::VALUE_BITS {
            return Err(());
        }

        let mut value: u32 = 0;
        let mut mantissa: usize = 0;
        for part in parts {
            let index = memorable_wordlist::WORDS
                .iter()
                .position(|x| *x == part)
                .ok_or(())? as u32;
            value |= index.checked_shl(mantissa as u32).ok_or(())?;
            mantissa += bits_per_digit;
        }

        Ok(Self { value })
    }
}
#[cfg(test)]
mod seed_tests {
    use super::Seed;

    #[test]
    fn encoding_decoding() {
        use rand::Rng;

        for _ in 0..1_000_000 {
            let seed = Seed {
                value: rand::thread_rng().gen(),
            };
            println!("value: {} seed: {}", seed.value, seed.to_string());
            let returned_seed: Seed = seed.to_string().parse().unwrap();
            assert_eq!(seed.value, returned_seed.value);
        }
    }
}
