use chrono::Utc;
use log::*;
use rand::{seq::SliceRandom, thread_rng};
use wamp_async::{WampArgs, WampError, WampKwArgs};

use crate::{
    errors::Error,
    game::{CardSlot, Player},
    util, AuthToken, ChatMessage, GameId, Message, GAME_LOBBY_CHANNEL, MSG_QUEUE,
    OPERATION_TIMEOUT, STATE,
};

/// Create a new game and add it to the state.
pub async fn make_game(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("make_game");
    wamp_kwargs!(kwargs, {
        player_name: String,        // The name of the player
    });

    let who = *[Player::Black, Player::White]
        .choose(&mut thread_rng())
        .unwrap();
    let (game_id, auth_token) = STATE.add_game_with_one_name(who, player_name.clone())?;

    trace!(
        "Creating game {} with player named {} (assigned {:?})",
        game_id.0.to_hyphenated(),
        player_name,
        who
    );

    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: GAME_LOBBY_CHANNEL.into(),
            args: None,
            kwargs: Some(STATE.get_open_games()?),
        })
        .expect("failed to queue message");

    Ok((
        None,
        Some(wamp_dict! {
            "assigned_color" => who,    // The player's color
            "game_id" => game_id,       // A unique game ID
            "token" => auth_token,      // The player's auth token
        }),
    ))
}

/// A player is resigning a game.
pub async fn resign_game(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("resign_game");
    wamp_kwargs!(kwargs, {
        game_id: GameId,    // The ID of the game being changed
        who: Player,        // The player making the move
        auth: AuthToken,    // The auth token for the player making the move
    });

    mutate_game!(local = STATE[game_id], who, auth, { local.resign(who) });

    STATE
        .broadcast_game_state_update(&game_id)
        .await
        .expect("Failed to broadcast state update!");

    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: util::get_chat_channel(&game_id).into(),
            args: None,
            kwargs: Some(wamp_dict! {
                "message" => ChatMessage {
                    player: None,
                    time: Utc::now(),
                    text: format!("{} resigns", who),
                },
            }),
        })
        .unwrap();

    Ok((None, None))
}

/// Make a move in a game.
pub async fn make_move(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    debug!("make_move");

    wamp_kwargs!(kwargs, {
        game_id: GameId,    // The ID of the game being changed
        who: Player,        // The player making the move
        auth: AuthToken,    // The auth token for the player making the move
        which: CardSlot,    // Which card is being played
        idx: u8,            // Which move on that card was chosen
        row: u8,            // Which row the source piece is on
        col: u8,            // Which column the source piece is on
    });

    let output = mutate_game!(local = STATE[game_id], who, auth, {
        local.play_card(row, col, who, which, idx)
    });

    if let Some(move_summary) = output {
        STATE.broadcast_game_state_update(&game_id).await.unwrap();

        MSG_QUEUE
            .get()
            .unwrap()
            .send(Message {
                topic: util::get_chat_channel(&game_id).into(),
                args: None,
                kwargs: Some(wamp_dict! {
                    "message" => ChatMessage {
                        player: None,
                        time: Utc::now(),
                        text: move_summary,
                    },
                }),
            })
            .unwrap();
        Ok((None, None))
    } else {
        Err(Error::IllegalMove.into())
    }
}

/// Join an existing game.
pub async fn join_game(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    debug!("join_game");

    wamp_kwargs!(kwargs, {
        player_name: String,    // The name of the player
        game_id: GameId,        // The ID of the game to join
    });

    let (who, auth_token, white, black) = {
        let global = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut running_game = global
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if let Some(who) = running_game.names.get_missing() {
            running_game.names[who] = Some(player_name);
            (
                who,
                running_game.tokens[who].clone(),
                running_game.names[Player::White].clone(),
                running_game.names[Player::Black].clone(),
            )
        } else {
            return Err(Error::GameFull.into());
        }
    };

    // Update the game lobby
    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: GAME_LOBBY_CHANNEL.into(),
            args: None,
            kwargs: Some(STATE.get_open_games()?),
        })
        .unwrap();

    // Update the game
    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: util::get_state_channel(&game_id).into(),
            args: None,
            kwargs: Some(wamp_dict! {
                "type" => "playerJoined",
                "white" => white,
                "black" => black,
            }),
        })
        .unwrap();

    Ok((
        None,
        Some(wamp_dict! {
            "assigned_color" => who,
            "token" => auth_token,
        }),
    ))
}

/// Get the list of open games.
pub async fn get_open_games(
    _: WampArgs,
    _: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("get_open_games");

    Ok((None, Some(STATE.get_open_games()?)))
}

/// Get the state for one game.
pub async fn get_game_state(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    debug!("get_game_data");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
    });

    let global = STATE
        .games
        .try_read_for(OPERATION_TIMEOUT)
        .ok_or(Error::LockTimeout)?;

    let running_game = global
        .get(&game_id)
        .ok_or(Error::UnknownGame)?
        .try_read_for(OPERATION_TIMEOUT)
        .ok_or(Error::LockTimeout)?;

    Ok((
        None,
        Some(wamp_dict! {
            "white" => running_game.names[Player::White],
            "black" => running_game.names[Player::Black],
            "state" => running_game.state,
        }),
    ))
}
