use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

use log::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{errors::Error, AuthToken};

const MIN_DAILY_DOUBLE_WAGER: u64 = 5;

const DUMMY_BOARD: JeopardyBoard = JeopardyBoard {
    categories: [
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
    ],
    daily_doubles: HashSet::new(), // thank you for being const
    value_multiplier: 0,
};
const DUMMY_CATEGORY: Category = Category {
    title: Cow::Borrowed(""),
    squares: [
        DUMMY_SQUARE,
        DUMMY_SQUARE,
        DUMMY_SQUARE,
        DUMMY_SQUARE,
        DUMMY_SQUARE,
    ],
};
const DUMMY_SQUARE: Square = Square {
    clue: Clue::Blank,
    answer: Cow::Borrowed(""),
    state: SquareState::Finished,
};

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub enum PlayerType {
    Moderator,
    Normal,
}

#[derive(Debug, Serialize, Hash, Eq, PartialEq)]
pub struct Location {
    category: usize, // 0 is left, 4 is right
    row: usize,      // 0 is top, 4 is bottom
}
impl Location {
    fn new(category: usize, row: usize) -> Option<Self> {
        if category < 5 && row < 5 {
            Some(Location { category, row })
        } else {
            None
        }
    }
}

#[derive(Debug, Serialize)]
struct JeopardyBoard {
    categories: [Category; 5],
    daily_doubles: HashSet<Location>,
    value_multiplier: u64, // base values are "1, 2, 3, 4, 5" going down a column
}
impl JeopardyBoard {
    fn get_square(&self, location: &Location) -> &Square {
        &self.categories[location.category].squares[location.row]
    }

    fn get_square_mut(&mut self, location: &Location) -> &mut Square {
        &mut self.categories[location.category].squares[location.row]
    }

    fn get_category_title(&self, category: usize) -> &str {
        &self.categories[category].title
    }
}

#[derive(Debug, Serialize)]
struct Category {
    title: Cow<'static, str>,
    squares: [Square; 5],
}

#[derive(Debug, Serialize)]
struct Square {
    clue: Clue,
    answer: Cow<'static, str>,
    state: SquareState,
}
impl Square {
    fn flip(&mut self) -> Result<(), Error> {
        self.state = match self.state {
            SquareState::Normal => SquareState::Flipped,
            _ => return Err(Error::InvalidSquareStateTransition),
        };

        Ok(())
    }

    fn finish(&mut self) -> Result<(), Error> {
        self.state = match self.state {
            SquareState::Flipped => SquareState::Finished,
            _ => return Err(Error::InvalidSquareStateTransition),
        };

        Ok(())
    }

    fn set_flip_state(&mut self, state: SquareState) {
        self.state = state;
    }
}

#[derive(Debug, Serialize)]
enum SquareState {
    Normal,
    Flipped,
    Finished,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum Clue {
    Text(String),
    Image(String),
    Video(String),
    Audio(String),
    Blank,
}

#[derive(Debug, Clone, Serialize)]
pub struct Player {
    name: String,
    score: i64,

    #[serde(skip)]
    auth: AuthToken,
}
impl Player {
    pub fn new(name: String) -> Self {
        Player {
            name,
            score: 0,
            auth: AuthToken(Uuid::new_v4()),
        }
    }

    pub fn get_auth(&self) -> AuthToken {
        self.auth.clone()
    }

    pub fn check_auth(&self, auth: &AuthToken) -> bool {
        self.auth == *auth
    }
}

#[derive(Debug, Serialize)]
enum GameState {
    NoBoard,
    WaitingForSquareSelection {
        board: JeopardyBoard,
        controller: Uuid, // ID of whoever's controlling the board
    },
    WaitingForDailyDoubleWager {
        board: JeopardyBoard,
        location: Location,
        controller: Uuid, // ID of whoever's making the wager
    },
    WaitingForBuzzer {
        board: JeopardyBoard,
        location: Location,
    },
    WaitingForAnswer {
        board: JeopardyBoard,
        location: Location,
        active_player: Uuid, // ID of whoever won the buzzer race or is doing the daily double
        value: u64,          // value added to score if correct, or subtracted if wrong
    },
}

#[derive(Debug, Serialize)]
pub struct Game {
    moderator: Player,
    players: HashMap<Uuid, Player>,
    state: GameState,
}
impl Game {
    pub fn new(moderator: Player) -> Self {
        Game {
            moderator,
            players: HashMap::new(),
            state: GameState::NoBoard,
        }
    }

    pub fn add_player(&mut self, id: Uuid, player: Player) -> Result<(), Error> {
        if matches!(self.state, GameState::NoBoard) {
            info!("Adding player: {} => {}", id, player.name);
            self.players.insert(id, player);
            Ok(())
        } else {
            Err(Error::InvalidStateForOperation)
        }
    }

    pub fn load_new_board(&mut self, multiplier: u64) -> Result<(), Error> {
        unimplemented!()
    }

    pub fn select_square(&mut self, location: Location) -> Result<(), Error> {
        let new_state = match self.state {
            GameState::WaitingForSquareSelection {
                ref mut board,
                controller,
            } => {
                board.get_square_mut(&location).flip()?;

                // Move to new state
                let mut new_board = DUMMY_BOARD;
                std::mem::swap(&mut new_board, board);
                if new_board.daily_doubles.contains(&location) {
                    GameState::WaitingForDailyDoubleWager {
                        board: new_board,
                        location,
                        controller,
                    }
                } else {
                    GameState::WaitingForBuzzer {
                        board: new_board,
                        location,
                    }
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };
        self.state = new_state;
        Ok(())
    }

    pub fn submit_wager(&mut self, wager: u64) -> Result<(), Error> {
        let new_state = match self.state {
            GameState::WaitingForDailyDoubleWager {
                ref mut board,
                controller,
                location,
            } => {
                // Move to new state
                if wager < MIN_DAILY_DOUBLE_WAGER {
                    return Err(Error::DailyDoubleWagerTooSmall);
                }

                let mut new_board = DUMMY_BOARD;
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForAnswer {
                    board: new_board,
                    location,
                    active_player: controller,
                    value: wager,
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };
        self.state = new_state;
        Ok(())
    }

    pub fn buzz(&mut self, id: Uuid) -> Result<(), Error> {
        let new_state = match self.state {
            GameState::WaitingForBuzzer { .. } => {
                if !self.players.contains_key(&id) {
                    return Err(Error::NoSuchPlayer);
                }
            }
        };

        self.state = new_state;
        Ok(())
    }
}
