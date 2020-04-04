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
}

const OPERATION_TIMEOUT: Duration = Duration::from_secs(5);
const GC_INTERVAL: Duration = Duration::from_secs(30 * 60);
const GC_CLEANUP_THRESHOLD: Duration = Duration::from_secs(60 * 60 * 24);
const ROUTER_PORT_ENV_NAME: &str = "ONTM_ROUTER_PORT";
const WAMP_REALM: &str = "ontm";
const GAME_LOBBY_CHANNEL: &str = "ontm.chan.lobby";

/// A game's ID.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct GameId(Uuid);

/// A player's auth token.
#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct AuthToken(Uuid);

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
    games: RwLock<HashMap<GameId, RwLock<RunningGame>>>,
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
    pub fn add_game_with_one_name(
        &self,
        who: game::Player,
        name: String,
    ) -> Result<(GameId, AuthToken), Error> {
        let game_id = GameId(Uuid::new_v4());
        let game = RunningGame::with_one_player_name(who, name);
        let auth_token = game.tokens[who].clone();

        self.games
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?
            .insert(game_id.clone(), RwLock::new(game));

        info!("New game ({:?}) added to global state", game_id);
        Ok((game_id, auth_token))
    }

    /// Gets the list of open games. Acquires the global game read lock, and each game's read lock
    /// as well.
    pub fn get_open_games(&self) -> Result<WampDict, Error> {
        Ok(wamp_dict! {
            "games" => self.games
                .try_read_for(OPERATION_TIMEOUT)
                .ok_or(Error::LockTimeout)?
                .iter()
                .filter_map(|(game_id, game)| {
                    let game = game.try_read_for(OPERATION_TIMEOUT).unwrap();
                    if let Some(player) = game.names.get_missing() {
                        Some((game_id, game.names[player.opponent()].clone()))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>(),
        })
    }

    /// Broadcasts a state update for the given game. If that game is over, remove it from the map.
    pub async fn broadcast_game_state_update(&self, game_id: &GameId) -> Result<(), Error> {
        info!("broadcast_game_state_update: {:?}", game_id);
        let mut winner_found = false;

        let kwargs = {
            let global = self
                .games
                .try_read_for(OPERATION_TIMEOUT)
                .ok_or(Error::LockTimeout)?;

            let running_game = global
                .get(&game_id)
                .ok_or(Error::UnknownGame)?
                .try_read_for(OPERATION_TIMEOUT)
                .ok_or(Error::LockTimeout)?;

            let winner = running_game.state.get_winner();
            if winner.is_some() {
                winner_found = true;
            }

            wamp_dict! {
                "state" => running_game.state,
                "winner" => winner,
            }
        };

        MSG_QUEUE
            .get()
            .unwrap()
            .send(Message {
                topic: Cow::Owned(util::get_state_channel(game_id)),
                args: None,
                kwargs: Some(kwargs),
            })
            .unwrap();

        if winner_found {
            self.remove_game(game_id)?;
        }

        Ok(())
    }
}

struct RunningGame {
    state: game::Game,
    names: util::PlayerData<Option<String>>,
    tokens: util::PlayerData<AuthToken>,
    time_started: DateTime<Utc>,
}
impl RunningGame {
    pub fn with_one_player_name(who: game::Player, name: String) -> Self {
        RunningGame {
            state: game::Game::default(),
            names: {
                let mut data = util::PlayerData::default();
                data[who] = Some(name);
                data
            },
            tokens: util::PlayerData {
                white: AuthToken(Uuid::new_v4()),
                black: AuthToken(Uuid::new_v4()),
            },
            time_started: Utc::now(),
        }
    }

    /// Sets one of the player's names.
    pub fn set_player_name(&mut self, who: game::Player, name: String) {
        self.names[who] = Some(name);
    }

    /// Gets the given player's access token.
    pub fn get_player_token(&self, who: game::Player) -> AuthToken {
        self.tokens[who].clone()
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
                    debug!("GC got lock");
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
        "ontm.new_game" => server::make_game,
        "ontm.move" => server::make_move,
        "ontm.join" => server::join_game,
        "ontm.open_games" => server::get_open_games,
        "ontm.game_state" => server::get_game_state,
        "ontm.resign" => server::resign_game,
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
