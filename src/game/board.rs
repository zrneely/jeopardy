use std::{convert::TryInto, fmt};

use rand::Rng;
use wamp_async::{Arg, WampDict};

use crate::{errors::Error, seed::Seed};

const CATEGORY_HEIGHT: usize = 5;

pub const DUMMY_BOARD: JeopardyBoard = JeopardyBoard {
    categories: Vec::new(),
    value_multiplier: 0,
    etag: 0,
    id: 0,
    seed: Seed::with_seed(0),
};

// Raw counts: 10, 433, 998, 1433, 945
const DAILY_DOUBLE_WEIGHTS: [f64; 5] = [0.002, 0.113, 0.261, 0.375, 0.247];

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq)]
pub struct Location {
    category: usize, // 0 is left, 4 is right
    row: usize,      // 0 is top, 4 is bottom
}
impl Location {
    pub fn new(category: usize, row: usize) -> Option<Self> {
        Some(Location { category, row })
    }

    // Uses the algorithm by Efraimidis and Spirakis from this paper:
    // https://utopia.duth.gr/~pefraimi/research/data/2007EncOfAlg.pdf
    pub fn gen_random_locations<R: Rng>(
        rng: &mut R,
        n: usize,
        categories: usize,
    ) -> Option<Vec<Self>> {
        if n > (categories * CATEGORY_HEIGHT) {
            return None;
        }

        // Indecies count down rows first, then across columns:
        // 0 3 6 9
        // 1 4 7 10
        // 2 5 8 11
        #[derive(Debug)]
        struct Item {
            data: usize, // index
            weight: f64,
            key: f64,
        }

        let mut new_item = |data: usize, weight: f64| {
            let u: f64 = rng.gen();
            Item {
                data,
                weight,
                key: u.powf(1.0 / weight),
            }
        };

        let candidates = {
            let mut candidates: Vec<Item> = Vec::with_capacity(categories * CATEGORY_HEIGHT);
            for i in 0..(categories * CATEGORY_HEIGHT) {
                candidates.push(new_item(i, DAILY_DOUBLE_WEIGHTS[i % CATEGORY_HEIGHT]));
            }

            candidates.sort_by(|a, b| {
                a.key
                    .partial_cmp(&b.key)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .reverse()
            });

            candidates
        };

        Some(
            candidates[0..n]
                .iter()
                .map(|item| Location {
                    row: item.data % CATEGORY_HEIGHT,
                    category: item.data / CATEGORY_HEIGHT,
                })
                .collect(),
        )
    }

    pub fn serialize(&self) -> WampDict {
        let mut result = WampDict::new();
        result.insert("category".into(), Arg::Integer(self.category));
        result.insert("row".into(), Arg::Integer(self.row));
        result
    }
}

#[derive(Debug)]
pub struct JeopardyBoard {
    categories: Vec<Category>,
    pub value_multiplier: i64, // base values are "1, 2, 3, ..." going down a column

    // Helpful for change tracking on the client. The etag
    // is internal to the board, and is incremented whenever
    // anything changes. The ID, on the other hand, is a global
    // counter per game which is incremented whenever an
    // entirely new board is created. The tuple (etag, id)
    // should be able to perfectly identify a board state
    // within a game.
    etag: usize,
    id: usize,

    seed: Seed,
}
impl JeopardyBoard {
    pub fn new(categories: Vec<Category>, value_multiplier: i64, id: usize, seed: Seed) -> Self {
        JeopardyBoard {
            categories,
            value_multiplier,
            etag: 0,
            id,
            seed,
        }
    }

    pub fn get_square(&self, location: &Location) -> &Square {
        &self.categories[location.category].squares[location.row]
    }

    pub fn get_square_mut(&mut self, location: &Location) -> &mut Square {
        self.etag += 1;
        &mut self.categories[location.category].squares[location.row]
    }

    pub fn get_square_value(&self, location: &Location) -> i64 {
        self.value_multiplier * (1 + (location.row as i64))
    }

    pub fn serialize(&self, for_moderator: bool, daily_double_entered: bool) -> WampDict {
        let mut result = WampDict::new();

        result.insert(
            "value_multiplier".into(),
            Arg::String(self.value_multiplier.to_string()),
        );

        result.insert("etag".into(), Arg::Integer(self.etag));
        result.insert("id".into(), Arg::Integer(self.id));
        result.insert("seed".into(), Arg::String(self.seed.to_string()));

        result.insert(
            "categories".into(),
            Arg::List(
                self.categories
                    .iter()
                    .map(|cat| Arg::Dict(cat.serialize(for_moderator, daily_double_entered)))
                    .collect(),
            ),
        );

        result
    }
}

#[derive(Debug, Clone)]
pub struct Category {
    pub title: String,
    pub commentary: Option<String>,
    pub air_year: u16,
    pub squares: [Square; CATEGORY_HEIGHT],
}
impl Category {
    fn serialize(&self, for_moderator: bool, daily_double_entered: bool) -> WampDict {
        let mut result = WampDict::new();

        result.insert("title".into(), Arg::String(self.title.clone()));
        result.insert(
            "air_year".into(),
            Arg::Integer(self.air_year.try_into().unwrap()),
        );

        if let Some(ref commentary) = self.commentary {
            result.insert("commentary".into(), Arg::String(commentary.clone()));
        }

        result.insert(
            "squares".into(),
            Arg::List(
                self.squares
                    .iter()
                    .map(|square| Arg::Dict(square.serialize(for_moderator, daily_double_entered)))
                    .collect(),
            ),
        );

        result
    }
}

#[derive(Debug, Clone)]
pub struct Square {
    pub clue: Clue,
    state: SquareState,
    pub answer: String,
    pub is_daily_double: bool,
}
impl Square {
    pub fn new(clue: Clue, answer: String) -> Self {
        Square {
            clue,
            answer,
            state: SquareState::Normal,
            is_daily_double: false,
        }
    }

    fn serialize(&self, for_moderator: bool, daily_double_entered: bool) -> WampDict {
        let mut result = WampDict::new();
        result.insert("state".into(), Arg::String(self.state.to_string()));

        if for_moderator {
            result.insert("clue".into(), Arg::Dict(self.clue.serialize()));
            result.insert("answer".into(), Arg::String(self.answer.clone()));
            result.insert("is_daily_double".into(), Arg::Bool(self.is_daily_double));
        } else {
            match (&self.state, daily_double_entered) {
                (SquareState::Normal, _) | (SquareState::DailyDoubleRevealed, false) => {}
                (SquareState::Flipped, _) | (SquareState::DailyDoubleRevealed, true) => {
                    result.insert("clue".into(), Arg::Dict(self.clue.serialize()));
                }
                (SquareState::Finished, _) => {
                    result.insert("clue".into(), Arg::Dict(self.clue.serialize()));
                    result.insert("answer".into(), Arg::String(self.answer.clone()));
                }
            }
        }

        result
    }

    pub(crate) fn flip(&mut self) -> Result<(), Error> {
        self.state = match self.state {
            SquareState::Normal => {
                if self.is_daily_double {
                    SquareState::DailyDoubleRevealed
                } else {
                    SquareState::Flipped
                }
            }
            _ => return Err(Error::InvalidSquareStateTransition),
        };

        Ok(())
    }

    pub(crate) fn finish(&mut self) -> Result<(), Error> {
        self.state = match self.state {
            SquareState::Flipped | SquareState::DailyDoubleRevealed => SquareState::Finished,
            _ => return Err(Error::InvalidSquareStateTransition),
        };

        Ok(())
    }

    pub fn set_flip_state(&mut self, state: SquareState) {
        self.state = state;
    }
}

#[derive(Debug, Clone)]
pub enum SquareState {
    Normal,
    DailyDoubleRevealed,
    Flipped,
    Finished,
}
impl fmt::Display for SquareState {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            SquareState::Normal => write!(fmt, "Normal"),
            SquareState::DailyDoubleRevealed => write!(fmt, "DailyDoubleRevealed"),
            SquareState::Flipped => write!(fmt, "Flipped"),
            SquareState::Finished => write!(fmt, "Finished"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Clue {
    pub text: Option<String>,
    pub link: Option<String>,
}
impl Clue {
    pub fn serialize(&self) -> WampDict {
        let mut result = WampDict::new();
        if let Some(ref text) = self.text {
            result.insert("text".into(), Arg::String(text.into()));
        }
        if let Some(ref link) = self.link {
            result.insert("link".into(), Arg::String(link.into()));
        }

        result
    }
}
