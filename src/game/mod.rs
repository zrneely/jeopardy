use std::{collections::HashMap, convert::TryInto};

use chrono::{DateTime, Utc};
use log::*;
use rand::{seq::SliceRandom, Rng, SeedableRng};
use uuid::Uuid;
use wamp_async::{Arg, WampDict};

use crate::{errors::Error, seed::Seed, AuthToken, PlayerId, CATEGORIES};

const MIN_DAILY_DOUBLE_WAGER: i64 = 5;
const MIN_MAX_DAILY_DOUBLE_WAGER_FACTOR: i64 = 50;

pub mod board;
use board::*;

pub enum AnswerType {
    Correct,
    Incorrect,
    Skip,
}
impl std::str::FromStr for AnswerType {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, ()> {
        Ok(match s {
            "Correct" => AnswerType::Correct,
            "Incorrect" => AnswerType::Incorrect,
            "Skip" => AnswerType::Skip,
            _ => return Err(()),
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub enum PlayerType {
    Moderator,
    Player,
}

#[derive(Debug, Clone)]
pub struct Player {
    name: String,
    score: i64,
    auth: AuthToken,
    avatar_url: String,
    final_jeopardy_wager: Option<i64>,
    final_jeopardy_answer: Option<String>,
}
impl Player {
    pub fn new(name: String, avatar_url: String) -> Self {
        Player {
            name,
            score: 0,
            auth: AuthToken(Uuid::new_v4()),
            avatar_url,
            final_jeopardy_wager: None,
            final_jeopardy_answer: None,
        }
    }

    pub fn get_auth(&self) -> AuthToken {
        self.auth.clone()
    }

    pub fn check_auth(&self, auth: &AuthToken) -> bool {
        self.auth == *auth
    }

    fn serialize(&self) -> WampDict {
        let mut result = WampDict::new();
        result.insert("name".into(), Arg::String(self.name.clone()));
        result.insert("score".into(), Arg::String(self.score.to_string()));
        result.insert("avatar_url".into(), Arg::String(self.avatar_url.clone()));
        result
    }
}

#[derive(Debug)]
enum GameState {
    NoBoard,
    WaitingForSquareSelection {
        board: Box<JeopardyBoard>,
        // ID of whoever's controlling the board, or None if there are no players yet
        controller: Option<PlayerId>,
    },
    WaitingForEnableBuzzer {
        board: Box<JeopardyBoard>,
        location: Location,
        controller: PlayerId,
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
    },
}
impl GameState {
    fn serialize_helper(
        &self,
        result: &mut WampDict,
        board: &JeopardyBoard,
        controller: Option<&PlayerId>,
        for_moderator: bool,
    ) {
        let daily_double_entered = !matches!(self, GameState::WaitingForDailyDoubleWager { .. });
        result.insert(
            "board".into(),
            Arg::Dict(board.serialize(for_moderator, daily_double_entered)),
        );
        if let Some(player_id) = controller {
            result.insert("controller".into(), Arg::String(player_id.to_string()));
        }
    }

    fn serialize_helper2(
        &self,
        result: &mut WampDict,
        board: &JeopardyBoard,
        controller: Option<&PlayerId>,
        location: &Location,
        for_moderator: bool,
    ) {
        self.serialize_helper(result, board, controller, for_moderator);
        result.insert("location".into(), Arg::Dict(location.serialize()));
    }

    fn serialize(&self, for_moderator: bool) -> WampDict {
        let mut result = WampDict::new();

        match self {
            GameState::NoBoard => {
                result.insert("type".into(), Arg::String("NoBoard".into()));
            }

            GameState::WaitingForSquareSelection { board, controller } => {
                result.insert(
                    "type".into(),
                    Arg::String("WaitingForSquareSelection".into()),
                );
                self.serialize_helper(&mut result, board, controller.as_ref(), for_moderator);
            }

            GameState::WaitingForEnableBuzzer { board, controller, location } => {
                result.insert(
                    "type".into(),
                    Arg::String("WaitingForEnableBuzzer".into()),
                );
                self.serialize_helper2(
                    &mut result,
                    board,
                    Some(controller),
                    location,
                    for_moderator,
                );
            }

            GameState::WaitingForDailyDoubleWager {
                board,
                controller,
                location,
            } => {
                result.insert(
                    "type".into(),
                    Arg::String("WaitingForDailyDoubleWager".into()),
                );
                self.serialize_helper2(
                    &mut result,
                    board,
                    Some(controller),
                    location,
                    for_moderator,
                );
            }

            GameState::WaitingForBuzzer {
                board,
                controller,
                location,
            } => {
                result.insert(
                    "type".into(),
                    Arg::String("WaitingForBuzzer".into()),
                );
                self.serialize_helper2(
                    &mut result,
                    board,
                    Some(controller),
                    location,
                    for_moderator,
                );
            }

            GameState::WaitingForAnswer {
                board,
                controller,
                location,
                active_player,
                .. // we don't need to send over the value of the current question
            } => {
                result.insert(
                    "type".into(),
                    Arg::String("WaitingForAnswer".into()),
                );
                self.serialize_helper2(
                    &mut result,
                    board,
                    Some(controller),
                    location,
                    for_moderator,
                );
                result.insert(
                    "active_player".into(),
                    Arg::String(active_player.to_string()),
                );
            }
        }

        result
    }
}

#[derive(Debug)]
pub struct Game {
    pub moderator_id: PlayerId,
    moderator: Player,
    players: HashMap<PlayerId, Player>,
    state: GameState,
    next_board_id: usize,

    pub time_started: DateTime<Utc>,
    pub moderator_state_channel: String,
    pub player_state_channel: String,
    pub is_ended: bool,
}
impl Game {
    pub(crate) fn new(moderator: Player) -> Self {
        let moderator_id = PlayerId(Uuid::new_v4());

        Game {
            moderator_id,
            moderator,
            players: HashMap::new(),
            state: GameState::NoBoard,
            next_board_id: 0,

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
        if (*id == self.moderator_id) && self.moderator.check_auth(auth) {
            return Some(PlayerType::Moderator);
        }

        if self.players.get(id)?.check_auth(auth) {
            return Some(PlayerType::Player);
        }

        None
    }

    pub(crate) fn get_moderator_name(&self) -> &str {
        &self.moderator.name
    }

    pub(crate) fn get_moderator_avatar_url(&self) -> &str {
        &self.moderator.avatar_url
    }

    pub(crate) fn get_player_names(&self) -> Vec<&str> {
        self.players
            .iter()
            .map(|(_id, player)| player.name.as_str())
            .collect()
    }

    fn serialize_common(&self) -> WampDict {
        let mut result = WampDict::new();

        result.insert("is_ended".into(), Arg::Bool(self.is_ended));
        result.insert(
            "players".into(),
            Arg::Dict(
                self.players
                    .iter()
                    .map(|(player_id, player)| {
                        (player_id.to_string(), Arg::Dict(player.serialize()))
                    })
                    .collect(),
            ),
        );

        result
    }

    pub(crate) fn serialize_for_moderator(&self) -> WampDict {
        let mut result = self.serialize_common();

        result.insert("state".into(), Arg::Dict(self.state.serialize(true)));
        result.insert("is_moderator".into(), Arg::Bool(true));

        result
    }

    pub(crate) fn serialize_for_players(&self) -> WampDict {
        let mut result = self.serialize_common();

        result.insert("state".into(), Arg::Dict(self.state.serialize(false)));
        result.insert("is_moderator".into(), Arg::Bool(false));

        result
    }

    pub(crate) fn add_player(&mut self, player: Player) -> PlayerId {
        let id = PlayerId(Uuid::new_v4());
        info!("Adding player: {:?} => {}", id, player.name);
        self.players.insert(id.clone(), player);

        // If we're currently in a WaitingForSquareSelection state and there's no controller,
        // make this player the controller.
        if let GameState::WaitingForSquareSelection {
            controller: ref mut controller @ None,
            ..
        } = self.state
        {
            *controller = Some(id.clone());
        }

        id
    }

    pub(crate) fn remove_player(&mut self, player_id: PlayerId) -> bool {
        if !self.players.contains_key(&player_id) {
            return false;
        }

        self.players.remove(&player_id);
        // Will be none if there are no longer any players
        let new_player = self.players.keys().next();

        let new_state = match (&mut self.state, new_player) {
            (GameState::NoBoard, _) => GameState::NoBoard,

            // If we're waiting for square selection, then it's valid to have a
            // controlling player, or not to. The new controller is either an
            // arbitrary other player, or nobody, in which case the only valid
            // action is adding a new player.
            (
                GameState::WaitingForSquareSelection {
                    controller,
                    ref mut board,
                },
                new_player,
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                GameState::WaitingForSquareSelection {
                    controller: if controller
                        .as_ref()
                        .map(|c| *c == player_id)
                        .unwrap_or(false)
                    {
                        new_player.cloned()
                    } else {
                        controller.clone()
                    },
                    board: new_board,
                }
            }

            // If we're waiting for the buzzer and there's another player
            // who can become the controller, make them the controller.
            (
                GameState::WaitingForBuzzer {
                    controller,
                    board,
                    location,
                },
                Some(new_player),
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                GameState::WaitingForBuzzer {
                    controller: if *controller == player_id {
                        new_player.clone()
                    } else {
                        controller.clone()
                    },
                    board: new_board,
                    location: *location,
                }
            }

            // If we're waiting to enable the buzzer and there's another player who
            // can become the controller, make them the controller.
            (
                GameState::WaitingForEnableBuzzer {
                    controller,
                    board,
                    location,
                },
                Some(new_player),
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                GameState::WaitingForEnableBuzzer {
                    controller: if *controller == player_id {
                        new_player.clone()
                    } else {
                        controller.clone()
                    },
                    board: new_board,
                    location: *location,
                }
            }

            // If we're waiting for the buzzer (or to enable the buzzer) and there's
            // no players left, finish the square and go back to WaitingForSquareSelection
            // with no controller.
            (
                GameState::WaitingForBuzzer {
                    board,
                    location,
                    controller,
                },
                None,
            )
            | (
                GameState::WaitingForEnableBuzzer {
                    board,
                    location,
                    controller,
                },
                None,
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                if *controller == player_id {
                    new_board
                        .get_square_mut(location)
                        .set_flip_state(SquareState::Finished);

                    GameState::WaitingForSquareSelection {
                        controller: None,
                        board: new_board,
                    }
                } else {
                    GameState::WaitingForBuzzer {
                        board: new_board,
                        location: *location,
                        controller: controller.clone(),
                    }
                }
            }

            // If we're waiting for an answer, and the active player leaves the game,
            // finish the square and go back to WaitingForSquareSelection.
            (
                GameState::WaitingForAnswer {
                    ref mut board,
                    location,
                    controller,
                    active_player,
                    value,
                },
                new_player,
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                let new_controller = if *controller == player_id {
                    new_player.cloned()
                } else {
                    Some(controller.clone())
                };

                if *active_player == player_id {
                    new_board
                        .get_square_mut(location)
                        .set_flip_state(SquareState::Finished);

                    GameState::WaitingForSquareSelection {
                        controller: new_controller,
                        board: new_board,
                    }
                } else {
                    // If there's now no players left, it must be the case that
                    // the active player, controller, and removal target are all
                    // the same player. Therefore, if we get here, there must have
                    // been multiple players prior to the remove call, and there
                    // will be a new controller.
                    GameState::WaitingForAnswer {
                        board: new_board,
                        location: *location,
                        controller: new_controller.expect("no new controller"),
                        active_player: active_player.clone(),
                        value: *value,
                    }
                }
            }

            // If the player making a daily double wager leaves, always finish the square
            // then just go back to WaitingForSquareSelection.
            (
                GameState::WaitingForDailyDoubleWager {
                    ref mut board,
                    location,
                    controller,
                },
                new_player,
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                if *controller == player_id {
                    new_board
                        .get_square_mut(location)
                        .set_flip_state(SquareState::Finished);

                    GameState::WaitingForSquareSelection {
                        board: new_board,
                        controller: new_player.cloned(),
                    }
                } else {
                    GameState::WaitingForDailyDoubleWager {
                        board: new_board,
                        location: *location,
                        controller: controller.clone(),
                    }
                }
            }
        };

        self.state = new_state;
        true
    }

    pub(crate) fn load_new_board(
        &mut self,
        multiplier: i64,
        daily_double_count: usize,
        categories: usize,
        seed: Seed,
    ) -> Result<(), Error> {
        self.next_board_id += 1;
        let board = self
            .make_random_board(
                multiplier,
                daily_double_count,
                categories,
                self.next_board_id,
                seed,
            )
            .ok_or(Error::TooManyDailyDoubles)?;
        let new_controller = self.get_random_player_with_lowest_score();

        match self.state {
            GameState::NoBoard => {
                let controller = self.get_random_player_with_lowest_score();
                self.state = GameState::WaitingForSquareSelection { board, controller }
            }

            GameState::WaitingForSquareSelection { .. } => {
                self.state = GameState::WaitingForSquareSelection {
                    board,
                    controller: new_controller,
                };
            }

            GameState::WaitingForAnswer { .. }
            | GameState::WaitingForDailyDoubleWager { .. }
            | GameState::WaitingForEnableBuzzer { .. }
            | GameState::WaitingForBuzzer { .. } => {
                self.state = GameState::WaitingForSquareSelection {
                    board,
                    controller: new_controller,
                };
            }
        };

        Ok(())
    }

    fn get_random_player_with_lowest_score(&self) -> Option<PlayerId> {
        let mut lowest_score = i64::max_value();
        let mut group_with_lowest_score = Vec::with_capacity(self.players.len());

        for (player_id, player) in &self.players {
            if player.score < lowest_score {
                group_with_lowest_score.clear();
                lowest_score = player.score;
            }

            if player.score == lowest_score {
                group_with_lowest_score.push(player_id.clone());
            }
        }

        group_with_lowest_score
            .choose(&mut rand::thread_rng())
            .cloned()
    }

    fn make_random_board(
        &self,
        multiplier: i64,
        daily_double_count: usize,
        category_count: usize,
        id: usize,
        seed: Seed,
    ) -> Option<Box<JeopardyBoard>> {
        let mut rng = rand_chacha::ChaCha20Rng::from_seed(seed.to_seed());

        let categories = (0..category_count)
            .map(|_| self.get_random_category(&mut rng))
            .collect();

        let mut board = Box::new(JeopardyBoard::new(categories, multiplier, id, seed));

        let daily_doubles =
            Location::gen_random_locations(&mut rng, daily_double_count, category_count)?;
        for location in daily_doubles {
            board.get_square_mut(&location).is_daily_double = true;
        }

        Some(board)
    }

    fn get_random_category<R: Rng>(&self, rng: &mut R) -> Category {
        CATEGORIES.get().unwrap().choose(rng).unwrap().clone()
    }

    pub(crate) fn select_square(&mut self, location: &Location) -> Result<(), Error> {
        let new_state = match &mut self.state {
            GameState::WaitingForSquareSelection {
                ref mut board,
                controller: Some(controller),
            } => {
                board.get_square_mut(&location).flip()?;

                // Move to new state
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                if new_board.get_square(&location).is_daily_double {
                    GameState::WaitingForDailyDoubleWager {
                        board: new_board,
                        location: *location,
                        controller: controller.clone(),
                    }
                } else {
                    GameState::WaitingForEnableBuzzer {
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

    pub(crate) fn enable_buzzer(&mut self) -> Result<(), Error> {
        match &mut self.state {
            GameState::WaitingForEnableBuzzer {
                board,
                controller,
                location,
            } => {
                // Move to new state
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                self.state = GameState::WaitingForBuzzer {
                    board: new_board,
                    location: *location,
                    controller: controller.clone(),
                };
            }

            _ => return Err(Error::InvalidStateForOperation),
        };

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
                let max_default_bid = MIN_MAX_DAILY_DOUBLE_WAGER_FACTOR * board.value_multiplier;
                let max_bid = max_default_bid.max(cur_score.try_into().unwrap());
                if wager > max_bid {
                    return Err(Error::DailyDoubleWagerOutOfRange);
                }

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForAnswer {
                    board: new_board,
                    location: *location,
                    active_player: controller.clone(),
                    controller: controller.clone(),
                    value: wager,
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

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForAnswer {
                    board: new_board,
                    location: *location,
                    active_player: id,
                    controller: controller.clone(),
                    value,
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };

        self.state = new_state;
        Ok(())
    }

    pub(crate) fn answer(&mut self, answer: AnswerType) -> Result<(), Error> {
        match (&mut self.state, answer) {
            // On a correct answer, the active player becomes the controller and the question ends.
            (
                GameState::WaitingForAnswer {
                    active_player,
                    value,
                    location,
                    ref mut board,
                    ..
                },
                AnswerType::Correct,
            ) => {
                let player = self
                    .players
                    .get_mut(&active_player)
                    .ok_or(Error::NoSuchPlayer)?;
                player.score += *value;

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                new_board.get_square_mut(location).finish()?;

                self.state = GameState::WaitingForSquareSelection {
                    board: new_board,
                    controller: Some(active_player.clone()),
                }
            }

            // On an incorrect answer, the controller does not change, and the question does not end.
            (
                GameState::WaitingForAnswer {
                    active_player,
                    value,
                    controller,
                    location,
                    board,
                },
                AnswerType::Incorrect,
            ) => {
                let player = self
                    .players
                    .get_mut(&active_player)
                    .ok_or(Error::NoSuchPlayer)?;
                player.score -= *value;

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                self.state = GameState::WaitingForBuzzer {
                    board: new_board,
                    controller: controller.clone(),
                    location: *location,
                };
            }

            // On a skip, the question ends, and the controller does not change.
            (
                GameState::WaitingForAnswer {
                    controller,
                    board,
                    location,
                    ..
                },
                AnswerType::Skip,
            )
            | (
                GameState::WaitingForBuzzer {
                    controller,
                    board,
                    location,
                },
                AnswerType::Skip,
            )
            | (
                GameState::WaitingForDailyDoubleWager {
                    controller,
                    board,
                    location,
                },
                AnswerType::Skip,
            ) => {
                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);

                new_board.get_square_mut(location).finish()?;

                self.state = GameState::WaitingForSquareSelection {
                    board: new_board,
                    controller: Some(controller.clone()),
                };
            }

            (_, _) => return Err(Error::InvalidStateForOperation),
        };

        Ok(())
    }

    pub(crate) fn set_square_state(
        &mut self,
        location: &Location,
        state: SquareState,
    ) -> Result<(), Error> {
        match self.state {
            GameState::WaitingForSquareSelection { ref mut board, .. }
            | GameState::WaitingForDailyDoubleWager { ref mut board, .. }
            | GameState::WaitingForBuzzer { ref mut board, .. }
            | GameState::WaitingForAnswer { ref mut board, .. } => {
                board.get_square_mut(location).set_flip_state(state);
            }

            _ => return Err(Error::InvalidStateForOperation),
        }

        Ok(())
    }

    pub(crate) fn set_player_score(&mut self, player: &PlayerId, score: i64) -> Result<(), Error> {
        self.players
            .get_mut(player)
            .ok_or(Error::NoSuchPlayer)?
            .score = score;
        Ok(())
    }
}
