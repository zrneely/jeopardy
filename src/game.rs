use std::{borrow::Cow, collections::HashMap, convert::TryInto};

use chrono::{DateTime, Utc};
use log::*;
use serde::Serialize;
use uuid::Uuid;

use crate::{errors::Error, AuthToken, PlayerId};

const MIN_DAILY_DOUBLE_WAGER: i64 = 5;
const MIN_MAX_DAILY_DOUBLE_WAGER: i64 = 1000;

const DUMMY_BOARD: JeopardyBoard = JeopardyBoard {
    categories: [
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
        DUMMY_CATEGORY,
    ],
    daily_doubles: Vec::new(), // thank you for being const
    value_multiplier: 0,
};
const DUMMY_CATEGORY: Category = Category {
    title: Cow::Borrowed("dummy"),
    commentary: None,
    squares: [
        DUMMY_SQUARE,
        DUMMY_SQUARE,
        DUMMY_SQUARE,
        DUMMY_SQUARE,
        DUMMY_SQUARE,
    ],
};
const DUMMY_SQUARE: Square = Square {
    clue: Clue {
        text: None,
        link: None,
    },
    answer: Cow::Borrowed("dummy"),
    state: SquareState::Finished,
};

#[derive(Debug, Clone, Copy, Serialize, Hash, Eq, PartialEq)]
pub struct Location {
    category: usize, // 0 is left, 4 is right
    row: usize,      // 0 is top, 4 is bottom
}
impl Location {
    pub fn new(category: usize, row: usize) -> Option<Self> {
        if category < 5 && row < 5 {
            Some(Location { category, row })
        } else {
            None
        }
    }
}

#[derive(Debug, Serialize)]
struct JeopardyBoard {
    categories: [Category; 6],
    daily_doubles: Vec<Location>,
    value_multiplier: i64, // base values are "1, 2, 3, 4, 5" going down a column
}
impl JeopardyBoard {
    fn get_square(&self, location: &Location) -> &Square {
        &self.categories[location.category].squares[location.row]
    }

    fn get_square_mut(&mut self, location: &Location) -> &mut Square {
        &mut self.categories[location.category].squares[location.row]
    }

    fn get_square_value(&self, location: &Location) -> i64 {
        self.value_multiplier * (1 + (location.row as i64))
    }

    fn get_category_title(&self, category: usize) -> &str {
        &self.categories[category].title
    }

    fn is_daily_double(&self, location: &Location) -> bool {
        self.daily_doubles.iter().any(|loc| loc == location)
    }
}

#[derive(Debug, Serialize)]
pub struct Category {
    pub title: Cow<'static, str>,
    pub commentary: Option<String>,
    pub squares: [Square; 5],
}

#[derive(Debug, Serialize)]
pub struct Square {
    clue: Clue,
    state: SquareState,

    #[serde(skip)]
    answer: Cow<'static, str>,
}
impl Square {
    pub fn new(clue: Clue, answer: String) -> Self {
        Square {
            clue,
            answer: Cow::Owned(answer),
            state: SquareState::Normal,
        }
    }

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
pub struct Clue {
    pub text: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum PlayerType {
    Moderator,
    Player,
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
#[serde(tag = "type")]
enum GameState {
    NoBoard,
    WaitingForSquareSelection {
        board: Box<JeopardyBoard>,
        controller: PlayerId, // ID of whoever's controlling the board
    },
    WaitingForDailyDoubleWager {
        board: Box<JeopardyBoard>,
        location: Location,
        controller: PlayerId, // ID of whoever's making the wager
    },
    WaitingForBuzzer {
        board: Box<JeopardyBoard>,
        location: Location,
        controller: PlayerId, // ID of whoever's controlling the board
    },
    WaitingForAnswer {
        board: Box<JeopardyBoard>,
        location: Location,
        controller: PlayerId,    // ID of whoever's controlling the board
        active_player: PlayerId, // ID of whoever won the buzzer race or is doing the daily double
        value: i64,              // Value added to score if correct, or subtracted if wrong
        answer: String,          // Answer to the current question
    },
}

#[derive(Debug)]
pub struct Game {
    pub moderator_id: PlayerId,
    players: HashMap<PlayerId, Player>,
    state: GameState,

    pub time_started: DateTime<Utc>,
    pub moderator_state_channel: String,
    pub player_state_channel: String,
    pub is_ended: bool,
}
impl Game {
    pub(crate) fn new(moderator: Player) -> Self {
        let moderator_id = PlayerId(Uuid::new_v4());
        let mut players = HashMap::new();
        players.insert(moderator_id.clone(), moderator);

        Game {
            moderator_id,
            players,
            state: GameState::NoBoard,

            time_started: Utc::now(),
            moderator_state_channel: format!("jpdy.chan.{}", Uuid::new_v4().to_hyphenated()),
            player_state_channel: format!("jpdy.chan.{}", Uuid::new_v4().to_hyphenated()),
            is_ended: false,
        }
    }

    pub(crate) fn auth_and_get_player_type(
        &self,
        id: &PlayerId,
        auth: &AuthToken,
    ) -> Option<PlayerType> {
        if self.players.get(id)?.check_auth(auth) {
            if *id == self.moderator_id {
                Some(PlayerType::Moderator)
            } else {
                Some(PlayerType::Player)
            }
        } else {
            None
        }
    }

    pub(crate) fn get_moderator_name(&self) -> Result<&str, Error> {
        Ok(&self
            .players
            .get(&self.moderator_id)
            .ok_or(Error::NoSuchPlayer)?
            .name)
    }

    pub(crate) fn get_player_names(&self) -> Vec<&str> {
        self.players
            .iter()
            .map(|(_id, player)| player.name.as_str())
            .collect()
    }

    pub(crate) fn serialize_for_moderator(&self) -> serde_json::Value {
        serde_json::json!({
            "state": self.state,
            "players": self.players,
            "is_ended": self.is_ended,
        })
    }

    pub(crate) fn serialize_for_players(&self) -> serde_json::Value {
        let mut special_state = serde_json::to_value(&self.state).unwrap();
        if matches!(self.state, GameState::WaitingForAnswer { .. }) {
            assert!(special_state
                .as_object_mut()
                .unwrap()
                .remove("answer")
                .is_some());
        }

        serde_json::json!({
            "state": special_state,
            "players": self.players,
            "is_ended": self.is_ended,
        })
    }

    pub(crate) fn add_player(&mut self, player: Player) -> PlayerId {
        let id = PlayerId(Uuid::new_v4());
        info!("Adding player: {:?} => {}", id, player.name);
        self.players.insert(id.clone(), player);
        id
    }

    pub(crate) fn load_new_board(&mut self, multiplier: i64) -> Result<(), Error> {
        unimplemented!()
    }

    pub(crate) fn select_square(&mut self, location: &Location) -> Result<(), Error> {
        let new_state = match &mut self.state {
            GameState::WaitingForSquareSelection {
                ref mut board,
                controller,
            } => {
                board.get_square_mut(&location).flip()?;

                // Move to new state
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                if new_board.is_daily_double(&location) {
                    GameState::WaitingForDailyDoubleWager {
                        board: new_board,
                        location: *location,
                        controller: controller.clone(),
                    }
                } else {
                    GameState::WaitingForBuzzer {
                        board: new_board,
                        location: *location,
                        controller: controller.clone(),
                    }
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };
        self.state = new_state;
        Ok(())
    }

    pub(crate) fn submit_wager(&mut self, wager: i64) -> Result<(), Error> {
        let new_state = match &mut self.state {
            GameState::WaitingForDailyDoubleWager {
                ref mut board,
                controller,
                location,
            } => {
                // Move to new state
                if wager < MIN_DAILY_DOUBLE_WAGER {
                    return Err(Error::DailyDoubleWagerOutOfRange);
                }

                let cur_score = self
                    .players
                    .get(&controller)
                    .ok_or(Error::NoSuchPlayer)?
                    .score;
                let max_bid = MIN_MAX_DAILY_DOUBLE_WAGER.max(cur_score.try_into().unwrap());
                if wager > max_bid {
                    return Err(Error::DailyDoubleWagerOutOfRange);
                }

                let answer = board.get_square(&location).answer.to_owned().to_string();

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForAnswer {
                    board: new_board,
                    location: *location,
                    active_player: controller.clone(),
                    controller: controller.clone(),
                    value: wager,
                    answer,
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };
        self.state = new_state;
        Ok(())
    }

    pub(crate) fn buzz(&mut self, id: PlayerId) -> Result<(), Error> {
        let new_state = match &mut self.state {
            GameState::WaitingForBuzzer {
                ref mut board,
                location,
                controller,
            } => {
                if !self.players.contains_key(&id) {
                    return Err(Error::NoSuchPlayer);
                }

                let value = board.get_square_value(&location);
                let answer = board.get_square(&location).answer.to_owned().to_string();

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForAnswer {
                    board: new_board,
                    location: *location,
                    active_player: id,
                    controller: controller.clone(),
                    value,
                    answer,
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };

        self.state = new_state;
        Ok(())
    }

    pub(crate) fn answer(&mut self, correct: bool) -> Result<(), Error> {
        let new_state = match &mut self.state {
            GameState::WaitingForAnswer {
                ref mut board,
                location,
                controller,
                active_player,
                value,
                ..
            } => {
                let player = self
                    .players
                    .get_mut(&active_player)
                    .ok_or(Error::NoSuchPlayer)?;
                if correct {
                    player.score += *value;
                } else {
                    player.score -= *value;
                }

                board.get_square_mut(location).finish()?;

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForSquareSelection {
                    board: new_board,
                    controller: if correct {
                        active_player.clone()
                    } else {
                        controller.clone()
                    },
                }
            }

            _ => return Err(Error::InvalidSquareStateTransition),
        };

        self.state = new_state;
        Ok(())
    }
}
