use std::{borrow::Cow, collections::HashMap, convert::TryInto, fmt};

use chrono::{DateTime, Utc};
use log::*;
use rand::{seq::SliceRandom, Rng, SeedableRng};
use uuid::Uuid;
use wamp_async::{Arg, WampDict};

use crate::{errors::Error, AuthToken, PlayerId, Seed, CATEGORIES};

const MIN_DAILY_DOUBLE_WAGER: i64 = 5;
const MIN_MAX_DAILY_DOUBLE_WAGER: i64 = 1000;
const CATEGORY_HEIGHT: usize = 5;

const DUMMY_BOARD: JeopardyBoard = JeopardyBoard {
    categories: Vec::new(),
    daily_doubles: Vec::new(),
    value_multiplier: 0,
    etag: 0,
    id: 0,
    seed: Seed { value: 0 },
};

// Raw counts: 10, 433, 998, 1433, 945
const DAILY_DOUBLE_WEIGHTS: [f64; 5] = [0.002, 0.113, 0.261, 0.375, 0.247];

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

    fn serialize(&self) -> WampDict {
        let mut result = WampDict::new();
        result.insert("category".into(), Arg::Integer(self.category));
        result.insert("row".into(), Arg::Integer(self.row));
        result
    }
}

#[derive(Debug)]
struct JeopardyBoard {
    categories: Vec<Category>,
    daily_doubles: Vec<Location>,
    value_multiplier: i64, // base values are "1, 2, 3, ..." going down a column

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
    fn get_square_mut(&mut self, location: &Location) -> &mut Square {
        self.etag += 1;
        &mut self.categories[location.category].squares[location.row]
    }

    fn get_square_value(&self, location: &Location) -> i64 {
        self.value_multiplier * (1 + (location.row as i64))
    }

    fn is_daily_double(&self, location: &Location) -> bool {
        self.daily_doubles.iter().any(|loc| loc == location)
    }

    fn serialize(&self, for_moderator: bool) -> WampDict {
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
                    .map(|cat| Arg::Dict(cat.serialize(for_moderator)))
                    .collect(),
            ),
        );

        if for_moderator {
            result.insert(
                "daily_doubles".into(),
                Arg::List(
                    self.daily_doubles
                        .iter()
                        .map(|dd| Arg::Dict(dd.serialize()))
                        .collect(),
                ),
            );
        }

        result
    }
}

#[derive(Debug, Clone)]
pub struct Category {
    pub title: Cow<'static, str>,
    pub commentary: Option<String>,
    pub squares: [Square; CATEGORY_HEIGHT],
}
impl Category {
    fn serialize(&self, for_moderator: bool) -> WampDict {
        let mut result = WampDict::new();

        result.insert(
            "title".into(),
            Arg::String(self.title.to_owned().to_string()),
        );

        if let Some(ref commentary) = self.commentary {
            result.insert("commentary".into(), Arg::String(commentary.clone()));
        }

        result.insert(
            "squares".into(),
            Arg::List(
                self.squares
                    .iter()
                    .map(|square| Arg::Dict(square.serialize(for_moderator)))
                    .collect(),
            ),
        );

        result
    }
}

#[derive(Debug, Clone)]
pub struct Square {
    clue: Clue,
    state: SquareState,
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

    fn serialize(&self, for_moderator: bool) -> WampDict {
        let mut result = WampDict::new();
        result.insert("state".into(), Arg::String(self.state.to_string()));

        if for_moderator {
            result.insert("clue".into(), Arg::Dict(self.clue.serialize()));
            result.insert(
                "answer".into(),
                Arg::String(self.answer.to_owned().to_string()),
            );
        } else {
            match self.state {
                SquareState::Normal => {}
                SquareState::Flipped => {
                    result.insert("clue".into(), Arg::Dict(self.clue.serialize()));
                }
                SquareState::Finished => {
                    result.insert("clue".into(), Arg::Dict(self.clue.serialize()));
                    result.insert(
                        "answer".into(),
                        Arg::String(self.answer.to_owned().to_string()),
                    );
                }
            }
        }

        result
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

#[derive(Debug, Clone)]
pub enum SquareState {
    Normal,
    Flipped,
    Finished,
}
impl fmt::Display for SquareState {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        match self {
            SquareState::Normal => write!(fmt, "Normal"),
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
    fn serialize(&self) -> WampDict {
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
}
impl Player {
    pub fn new(name: String, avatar_url: String) -> Self {
        Player {
            name,
            score: 0,
            auth: AuthToken(Uuid::new_v4()),
            avatar_url,
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
        result: &mut WampDict,
        board: &JeopardyBoard,
        controller: Option<&PlayerId>,
        for_moderator: bool,
    ) {
        result.insert("board".into(), Arg::Dict(board.serialize(for_moderator)));
        if let Some(player_id) = controller {
            result.insert("controller".into(), Arg::String(player_id.to_string()));
        }
    }

    fn serialize_helper2(
        result: &mut WampDict,
        board: &JeopardyBoard,
        controller: Option<&PlayerId>,
        location: &Location,
        for_moderator: bool,
    ) {
        GameState::serialize_helper(result, board, controller, for_moderator);
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
                GameState::serialize_helper(&mut result, board, controller.as_ref(), for_moderator);
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
                GameState::serialize_helper2(
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
                GameState::serialize_helper2(
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
                GameState::serialize_helper2(
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

        let new_state = match &self.state {
            GameState::NoBoard => {
                let controller = self.get_random_player_with_lowest_score();
                GameState::WaitingForSquareSelection { board, controller }
            }

            GameState::WaitingForSquareSelection { controller, .. } => {
                GameState::WaitingForSquareSelection {
                    board,
                    controller: controller.clone(),
                }
            }

            GameState::WaitingForAnswer { controller, .. }
            | GameState::WaitingForDailyDoubleWager { controller, .. }
            | GameState::WaitingForBuzzer { controller, .. } => {
                GameState::WaitingForSquareSelection {
                    board,
                    controller: Some(controller.clone()),
                }
            }
        };

        self.state = new_state;
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

        Some(Box::new(JeopardyBoard {
            categories,
            value_multiplier: multiplier,
            daily_doubles: Location::gen_random_locations(
                &mut rng,
                daily_double_count,
                category_count,
            )?,
            etag: 0,
            id,
            seed,
        }))
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
        let new_controller = match &mut self.state {
            GameState::WaitingForAnswer {
                active_player,
                value,
                controller,
                ..
            } => {
                let player = self
                    .players
                    .get_mut(&active_player)
                    .ok_or(Error::NoSuchPlayer)?;
                match answer {
                    AnswerType::Correct => {
                        player.score += *value;
                        active_player.clone()
                    }
                    AnswerType::Incorrect => {
                        player.score -= *value;
                        controller.clone()
                    }
                    AnswerType::Skip => controller.clone(),
                }
            }

            GameState::WaitingForBuzzer { controller, .. } => controller.clone(),
            GameState::WaitingForDailyDoubleWager { controller, .. } => controller.clone(),

            _ => return Err(Error::InvalidStateForOperation),
        };

        let new_state = match &mut self.state {
            GameState::WaitingForAnswer {
                ref mut board,
                location,
                ..
            }
            | GameState::WaitingForBuzzer {
                ref mut board,
                location,
                ..
            }
            | GameState::WaitingForDailyDoubleWager {
                ref mut board,
                location,
                ..
            } => {
                board.get_square_mut(location).finish()?;

                let mut new_board = Box::new(DUMMY_BOARD);
                std::mem::swap(&mut new_board, board);
                GameState::WaitingForSquareSelection {
                    board: new_board,
                    controller: Some(new_controller),
                }
            }

            _ => return Err(Error::InvalidStateForOperation),
        };

        self.state = new_state;
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
