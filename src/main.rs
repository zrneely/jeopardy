#![allow(dead_code)]

use std::{borrow::Cow, collections::HashMap, env, time::Duration};

use chrono::{DateTime, Utc};
use log::*;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use uuid::Uuid;
use wamp_async::WampDict;

mod data;
mod errors;
mod game;
#[macro_use]
mod util;
mod server;

use errors::Error;

lazy_static::lazy_static! {
    static ref STATE: OnitamaState = OnitamaState {
        games: RwLock::new(HashMap::new()),
    };

    static ref MSG_QUEUE: OnceCell<mpsc::UnboundedSender<Message>> = OnceCell::new();

    static ref CATEGORIES: OnceCell<Vec<game::Category>> = OnceCell::new();
}

const OPERATION_TIMEOUT: Duration = Duration::from_secs(5);
const GC_INTERVAL: Duration = Duration::from_secs(30 * 60);
const GC_CLEANUP_THRESHOLD: Duration = Duration::from_secs(60 * 60 * 24);
const ROUTER_PORT_ENV_NAME: &str = "JPDY_ROUTER_PORT";
const WAMP_REALM: &str = "jpdy";
const GAME_LOBBY_CHANNEL: &str = "jpdy.chan.lobby";
const DATABASE_PATH: &str = "jeo_data_utf8.csv";

/// A game's ID.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct GameId(Uuid);

/// A player's auth token.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct AuthToken(Uuid);

/// A player ID.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlayerId(Uuid);

/// A message to be sent (typically from an RPC invocation)
#[derive(Debug)]
struct Message {
    topic: Cow<'static, str>,
    args: wamp_async::WampArgs,
    kwargs: wamp_async::WampKwArgs,
}

struct OnitamaState {
    // Use a double RwLock here so that when mutating a game, we can take a read lock
    // on the games instance, allowing multiple games to be mutated simultaneously. The only
    // time a write lock is needed on the outer HashMap is when new games are added or old ones are
    // removed. Other possible improvements include having multiple maps and choosing randomly
    // which one to add to in order to further reduce the chance of lock contention.
    games: RwLock<HashMap<GameId, RwLock<game::Game>>>,
}
impl OnitamaState {
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
    ) -> Result<(GameId, PlayerId, AuthToken, String), Error> {
        let game_id = GameId(Uuid::new_v4());
        let moderator = game::Player::new(moderator_name);
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
    pub fn get_games(&self) -> Result<WampDict, Error> {
        let games = self
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let games = games
            .iter()
            .filter_map(|(game_id, game)| {
                let game = game.try_read_for(OPERATION_TIMEOUT)?;

                Some(wamp_dict! {
                    "id" => game_id,
                    "owner" => game.get_moderator_name().ok()?,
                    "players" => game.get_player_names(),
                })
            })
            .collect::<Vec<_>>();

        Ok(wamp_dict! {
            "games" => games,
        })
    }

    pub fn add_player(
        &self,
        game_id: &GameId,
        player_name: String,
    ) -> Result<(PlayerId, AuthToken), Error> {
        let games = self
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let player = game::Player::new(player_name);
        let auth_token = player.get_auth();
        let id = game.add_player(player);

        Ok((id, auth_token))
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

            let moderator_state = game.serialize_for_moderator();
            let player_state = game.serialize_for_players();

            MSG_QUEUE
                .get()
                .unwrap()
                .send(Message {
                    topic: Cow::Owned(game.moderator_state_channel.clone()),
                    args: None,
                    kwargs: Some(wamp_dict! {
                        "state" => moderator_state,
                    }),
                })
                .unwrap();

            MSG_QUEUE
                .get()
                .unwrap()
                .send(Message {
                    topic: Cow::Owned(game.player_state_channel.clone()),
                    args: None,
                    kwargs: Some(wamp_dict! {
                        "state" => player_state,
                    }),
                })
                .unwrap();

            game.is_ended
        };

        if is_ended {
            self.remove_game(&game_id)?;
        }

        Ok(())
    }
}

/// A chat message displayed to the players.
#[derive(Debug, Clone, Serialize)]
struct ChatMessage {
    player: Option<game::Player>, // if none, system message
    time: DateTime<Utc>,
    text: String,
}

#[tokio::main]
async fn main() {
    env_logger::init();

    let mut categories = Vec::new();
    let time_taken = chrono::Duration::span(|| categories = data::load(DATABASE_PATH).unwrap());
    trace!(
        "Loaded {} categories in {} ms",
        categories.len(),
        time_taken.num_milliseconds()
    );
    CATEGORIES.set(categories).unwrap();

    // TODO: remove, just for testing
    use rand::seq::SliceRandom;
    for _ in 0..5 {
        let category = &CATEGORIES.get().unwrap()[..]
            .choose(&mut rand::thread_rng())
            .unwrap();
        trace!("Random category: {:#?}", category);
    }

    // Create our MPSC pair
    let (sender, mut receiver) = mpsc::unbounded_channel();
    MSG_QUEUE.set(sender).unwrap();

    let port: u16 = env::var(ROUTER_PORT_ENV_NAME)
        .expect("Missing router port")
        .parse()
        .expect("Router port not integer");

    info!("Connecting to WAMP server on port {}", port);
    let mut client = wamp_async::Client::connect(
        format!("ws://127.0.0.1:{}/ws", port),
        Some(
            wamp_async::ClientConfig::new().set_serializers(vec![wamp_async::SerializerType::Json]),
        ),
    )
    .await
    .expect("Failed to connect to router!");

    let (evt_loop, rpc_queue) = client
        .event_loop()
        .expect("Failed to start WAMP event loop!");

    // Spawn the WAMP event loop (which enables processing messages out-of-order).
    tokio::spawn(evt_loop);

    // Spawn each new RPC call on its own task.
    tokio::spawn(async move {
        let mut rpc_queue = rpc_queue.expect("Missing RPC event queue!");
        while let Some(rpc_event) = rpc_queue.recv().await {
            tokio::spawn(rpc_event);
        }
    });

    info!("Connected!");

    // Spawn the garbage collection task (it removes games started more than 24 hours ago).
    tokio::spawn(async move {
        loop {
            tokio::time::delay_for(GC_INTERVAL).await;

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
    info!("Joined realm {}", WAMP_REALM);

    rpc_register!(client, {
        // Meta functions
        "jpdy.new_game" => server::make_game,
        "jpdy.join" => server::join_game,
        "jpdy.list_games" => server::get_games,
        // "jpdy.lag_test" => server::lag_test,
        "jpdy.game_state" => server::get_game_state,

        // Moderator-only functions
        "jpdy.end_game" => server::end_game,
        // "jpdy.new_board" => server::new_board,
        "jpdy.select_square" => server::select_square,
        "jpdy.answer" => server::answer,
        // "jpdy.change_square_state" => server::change_square_state,
        // "jpdy.change_player_score" => server::change_player_score,

        // Player-only functions
        "jpdy.submit_wager" => server::submit_wager,
        "jpdy.buzz" => server::buzz,

    })
    .await
    .into_iter()
    .collect::<Result<Vec<_>, _>>()
    .expect("Failed to register RPCs!");
    info!("RPCs registered!");

    while let Some(msg) = receiver.recv().await {
        trace!("Publishing message: {:?}", msg);
        client
            .publish(msg.topic, msg.args, msg.kwargs, false)
            .await
            .expect("Failed to send message");
    }
}
