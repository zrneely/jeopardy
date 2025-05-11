use std::{borrow::Cow, collections::HashMap, env, fmt, path::PathBuf, time::Duration};

use chrono::Utc;
use futures::lock::Mutex;
use log::*;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use tokio::sync::mpsc;
use uuid::Uuid;
use wamp_async::{WampKwArgs, WampPayloadValue};

#[macro_use]
mod util;

mod avatar;
mod data;
mod errors;
mod game;
mod seed;
mod server;

use avatar::AvatarManager;
use errors::Error;

lazy_static::lazy_static! {
    static ref STATE: JeopardyState = JeopardyState {
        games: RwLock::new(HashMap::new()),
    };

    static ref MSG_QUEUE: OnceCell<mpsc::UnboundedSender<Message>> = OnceCell::new();

    static ref JEOPARDY_DATA: OnceCell<data::JeopardyData> = OnceCell::new();

    static ref AVATAR_DIRECTORY: PathBuf = {
        let mut buf = PathBuf::new();
        buf.push("static");
        buf.push("avatars");
        buf
    };

    static ref AVATAR_MANAGER: Mutex<AvatarManager> = Mutex::new(AvatarManager::new(
        AVATAR_DIRECTORY.clone(),
        "avatars".into(),
        MAX_AVATAR_SIZE
    ).unwrap());
}

const OPERATION_TIMEOUT: Duration = Duration::from_secs(5);
const GC_INTERVAL: Duration = Duration::from_secs(30 * 60);
const GC_CLEANUP_THRESHOLD: Duration = Duration::from_secs(60 * 60 * 24);
const ROUTER_PORT_ENV_NAME: &str = "JPDY_ROUTER_PORT";
const WAMP_REALM: &str = "jpdy";
const GAME_LOBBY_CHANNEL: &str = "jpdy.chan.lobby";
const DATABASE_PATH: &str = "jeo_data_utf8.csv.gz";
const MAX_AVATAR_SIZE: usize = 32 * 1024;

/// A game's ID.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct GameId(Uuid);
impl fmt::Display for GameId {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        write!(fmt, "{}", self.0.hyphenated())
    }
}

/// A player's auth token.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct AuthToken(Uuid);
impl fmt::Display for AuthToken {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        write!(fmt, "{}", self.0.hyphenated())
    }
}

/// A player ID.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct PlayerId(Uuid);
impl fmt::Display for PlayerId {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        write!(fmt, "{}", self.0.hyphenated())
    }
}

/// A message to be sent (typically from an RPC invocation)
#[derive(Debug)]
struct Message {
    topic: Cow<'static, str>,
    args: Option<wamp_async::WampArgs>,
    kwargs: Option<wamp_async::WampKwArgs>,
}

struct JeopardyState {
    // Use a double RwLock here so that when mutating a game, we can take a read lock
    // on the games instance, allowing multiple games to be mutated simultaneously. The only
    // time a write lock is needed on the outer HashMap is when new games are added or old ones are
    // removed. Other possible improvements include having multiple maps and choosing randomly
    // which one to add to in order to further reduce the chance of lock contention.
    games: RwLock<HashMap<GameId, RwLock<game::Game>>>,
}
impl JeopardyState {
    /// Deletes a game from the map. Will acquire the global game write lock.
    fn remove_game(&self, game: &GameId) -> Result<(), Error> {
        info!("removing game: {:?}", game);
        self.games
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?
            .remove(game);
        Ok(())
    }

    /// Adds a game to the state. Will acquire (and release) the global game write lock.
    pub fn add_game(
        &self,
        moderator_name: String,
        avatar_url: String,
    ) -> Result<(GameId, PlayerId, AuthToken, String), Error> {
        let game_id = GameId(Uuid::new_v4());
        let moderator = game::Player::new(moderator_name, avatar_url);
        let auth_token = moderator.get_auth();
        let game = game::Game::new(moderator);
        let user_id = game.moderator_id.clone();
        let moderator_channel = game.moderator_state_channel.clone();

        self.games
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?
            .insert(game_id.clone(), RwLock::new(game));

        info!("New game ({:?}) added to global state", game_id);
        Ok((game_id, user_id, auth_token, moderator_channel))
    }

    /// Gets the list of open games. Acquires the global game read lock, and each game's read lock
    /// as well.
    pub fn get_games(&self) -> Result<WampKwArgs, Error> {
        let games = self
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let games = games
            .iter()
            .filter_map(|(game_id, game)| {
                let game = game.try_read_for(OPERATION_TIMEOUT)?;

                let mut dict = wamp_dict! {
                    "game_id" => game_id.to_string(),
                    "moderator" => game.get_moderator_name().into(),
                    "moderator_avatar" => game.get_moderator_avatar_url().into(),
                    "channel" => game.player_state_channel.clone(),
                };
                let players = WampPayloadValue::Array(
                    game.get_player_names()
                        .iter()
                        .map(|name| WampPayloadValue::String((*name).to_string()))
                        .collect(),
                );
                dict.insert("players".to_string(), players);

                Some(WampPayloadValue::Object(dict))
            })
            .collect::<Vec<_>>();

        let mut result = WampKwArgs::new();
        result.insert("games".to_string(), WampPayloadValue::Array(games));

        result.insert(
            "min_year".to_string(),
            WampPayloadValue::Number(JEOPARDY_DATA.get().unwrap().min_year.into()),
        );
        result.insert(
            "max_year".to_string(),
            WampPayloadValue::Number(JEOPARDY_DATA.get().unwrap().max_year.into()),
        );

        Ok(result)
    }

    /// Broadcasts a state update for the given game. If that game is over, remove it from the map.
    pub async fn broadcast_game_state_update(&self, game_id: &GameId) -> Result<(), Error> {
        info!("broadcast_game_state_update: {:?}", game_id);

        let is_ended = {
            let games = self
                .games
                .try_read_for(OPERATION_TIMEOUT)
                .ok_or(Error::LockTimeout)?;
            let game = games
                .get(game_id)
                .ok_or(Error::UnknownGame)?
                .try_read_for(OPERATION_TIMEOUT)
                .ok_or(Error::LockTimeout)?;

            let moderator_state = game.serialize(true);
            let player_state = game.serialize(false);

            MSG_QUEUE
                .get()
                .unwrap()
                .send(Message {
                    topic: Cow::Owned(game.moderator_state_channel.clone()),
                    args: None,
                    kwargs: Some(moderator_state),
                })
                .unwrap();

            MSG_QUEUE
                .get()
                .unwrap()
                .send(Message {
                    topic: Cow::Owned(game.player_state_channel.clone()),
                    args: None,
                    kwargs: Some(player_state),
                })
                .unwrap();

            game.is_ended
        };

        if is_ended {
            self.remove_game(game_id)?;
        }

        Ok(())
    }
}

#[tokio::main]
async fn main() {
    env_logger::init();

    let start = chrono::Utc::now();
    let jeopardy_data = data::load(DATABASE_PATH);
    let time_taken = chrono::Utc::now() - start;

    info!(
        "Loaded {} categories and {} final jeopardy questions in {} ms (min year: {}, max year: {})",
        jeopardy_data.categories.len(),
        jeopardy_data.final_jeopardy_questions.len(),
        time_taken.num_milliseconds(),
        jeopardy_data.min_year,
        jeopardy_data.max_year,
    );
    JEOPARDY_DATA.set(jeopardy_data).unwrap();

    // Create our MPSC pair
    let (sender, mut receiver) = mpsc::unbounded_channel();
    MSG_QUEUE.set(sender).unwrap();

    let port: u16 = env::var(ROUTER_PORT_ENV_NAME)
        .expect("Missing router port")
        .parse()
        .expect("Router port not integer");

    info!("Connecting to WAMP server on port {}", port);
    let (mut client, (event_loop, rpc_queue)) = wamp_async::Client::connect(
        format!("ws://127.0.0.1:{}/ws", port),
        Some(
            wamp_async::ClientConfig::default()
                .set_serializers(vec![wamp_async::SerializerType::Json]),
        ),
    )
    .await
    .expect("Failed to connect to router!");
    info!("Connected!");

    // Spawn the WAMP event loop (which enables processing messages out-of-order).
    tokio::spawn(event_loop);

    // Spawn each new RPC call on its own task.
    tokio::spawn(async move {
        let mut rpc_queue = rpc_queue.expect("Missing RPC event queue!");
        while let Some(rpc_event) = rpc_queue.recv().await {
            tokio::spawn(rpc_event);
        }
    });

    info!("Event loop and RPC queue ready!");

    // Spawn the garbage collection task (it removes games started more than 24 hours ago).
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(GC_INTERVAL).await;

            info!("GC running...");
            let now = Utc::now();

            match STATE.games.try_write_for(OPERATION_TIMEOUT) {
                Some(mut lock) => {
                    trace!("GC got lock");
                    let old_count = lock.len();

                    lock.retain(|_, ref mut v| {
                        let time_since_started =
                            now.signed_duration_since(v.get_mut().time_started);
                        time_since_started
                            < chrono::Duration::from_std(GC_CLEANUP_THRESHOLD).unwrap()
                    });

                    info!("GC done; removed {} games.", old_count - lock.len());
                }
                None => {
                    warn!("GC could not run! Lock acquire timed out.");
                }
            }
        }
    });

    client
        .join_realm(WAMP_REALM)
        .await
        .expect("Failed to join realm!");
    info!("Joined realm {}!", WAMP_REALM);

    rpc_register!(client, {
        // Meta functions
        "jpdy.new_game" => server::make_game,
        "jpdy.join" => server::join_game,
        "jpdy.leave" => server::leave_game,
        "jpdy.list_games" => server::get_games,
        "jpdy.game_state" => server::get_game_state,

        // Moderator-only functions
        "jpdy.end_game" => server::end_game,
        "jpdy.new_board" => server::new_board,
        "jpdy.select_square" => server::select_square,
        "jpdy.enable_buzzer" => server::enable_buzzer,
        "jpdy.answer" => server::answer,
        "jpdy.final_jeopardy.start" => server::start_final_jeopardy,
        "jpdy.final_jeopardy.reveal_question" => server::reveal_final_jeopardy_question,
        "jpdy.final_jeopardy.lock_answers" => server::lock_final_jeopardy_answers,
        "jpdy.final_jeopardy.reveal_info" => server::reveal_final_jeopardy_info,
        "jpdy.final_jeopardy.evaluate_answer" => server::evaluate_final_jeopardy_answer,
        "jpdy.change_square_state" => server::change_square_state,
        "jpdy.change_player_score" => server::change_player_score,

        // Player-only functions
        "jpdy.submit_wager" => server::submit_wager,
        "jpdy.buzz" => server::buzz,
        "jpdy.submit_final_jeopardy_answer" => server::submit_final_jeopardy_answer,
    })
    .await
    .into_iter()
    .collect::<Result<Vec<_>, _>>()
    .expect("Failed to register RPCs!");
    info!("RPCs registered!");

    while let Some(msg) = receiver.recv().await {
        client
            .publish(msg.topic, msg.args, msg.kwargs, false)
            .await
            .expect("Failed to send message");
    }
}
