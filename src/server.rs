use log::*;
use wamp_async::{WampArgs, WampError, WampKwArgs};

use crate::{
    errors::Error,
    game::{Location, Player, PlayerType, SquareState},
    AuthToken, GameId, Message, PlayerId, GAME_LOBBY_CHANNEL, MSG_QUEUE, OPERATION_TIMEOUT, STATE,
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

    let (game_id, player_id, auth_token, moderator_channel) =
        STATE.add_game(player_name.clone())?;

    trace!(
        "Creating game {} with moderator named {} (assigned mod channel: {:?})",
        game_id.0.to_hyphenated(),
        player_name,
        moderator_channel
    );

    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: GAME_LOBBY_CHANNEL.into(),
            args: None,
            kwargs: Some(STATE.get_games()?),
        })
        .unwrap();

    Ok((
        None,
        Some(wamp_dict! {
            "game_id" => game_id,       // A unique game ID
            "token" => auth_token,      // The player's auth token
            "player_id" => player_id,   // The player's ID
            "moderator_channel" => moderator_channel, // The channel for the moderator to subscribe to
        }),
    ))
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

    let (auth_token, player_id, player_channel) = {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let player = Player::new(player_name);
        let auth = player.get_auth();
        let player_id = game.add_player(player);

        (auth, player_id, game.player_state_channel.clone())
    };

    // Update the game lobby
    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: GAME_LOBBY_CHANNEL.into(),
            args: None,
            kwargs: Some(STATE.get_games()?),
        })
        .unwrap();

    // Update the moderator.
    STATE.broadcast_game_state_update(&game_id).await?;

    Ok((
        None,
        Some(wamp_dict! {
            "player_id" => player_id,
            "token" => auth_token,
            "channel" => player_channel,
        }),
    ))
}

/// Get the list of open games.
pub async fn get_games(_: WampArgs, _: WampKwArgs) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("get_games");
    Ok((None, Some(STATE.get_games()?)))
}

/// Get the state for one game.
pub async fn get_game_state(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    debug!("get_game_data");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
    });

    let games = STATE
        .games
        .try_read_for(OPERATION_TIMEOUT)
        .ok_or(Error::LockTimeout)?;

    let game = games
        .get(&game_id)
        .ok_or(Error::UnknownGame)?
        .try_read_for(OPERATION_TIMEOUT)
        .ok_or(Error::LockTimeout)?;

    match game.auth_and_get_player_type(&player_id, &auth) {
        Some(PlayerType::Moderator) => Ok((
            None,
            Some(wamp_dict! {
                "state" => game.serialize_for_moderator(),
            }),
        )),
        Some(PlayerType::Player) => Ok((
            None,
            Some(wamp_dict! {
                "state" => game.serialize_for_players(),
            }),
        )),
        None => Err(Error::NoSuchPlayer.into()),
    }
}

/// Moderator only: end a game
pub async fn end_game(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("end_game");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Moderator)
        ) {
            game.is_ended = true;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: select a square
pub async fn select_square(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("select_square");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
        category: usize,
        row: usize,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Moderator)
        ) {
            let location = Location::new(category, row).ok_or(Error::InvalidSquare)?;
            game.select_square(&location)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: a player gave an answer (outside of the game)
pub async fn answer(_: WampArgs, kwargs: WampKwArgs) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("answer");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
        correct: bool,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Moderator)
        ) {
            game.answer(correct)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: change to a fresh board
pub async fn new_board(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("new_board");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
        multiplier: i64,
        daily_doubles: usize,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Moderator)
        ) {
            game.load_new_board(multiplier, daily_doubles)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: change a square's state
pub async fn change_square_state(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("change_square_state");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
        category: usize,
        row: usize,
        new_state: bool, // true: ready, false: finished
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Moderator)
        ) {
            let location = Location::new(category, row).ok_or(Error::InvalidSquare)?;
            game.set_square_state(
                &location,
                if new_state {
                    SquareState::Normal
                } else {
                    SquareState::Finished
                },
            )?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: change a player's score
pub async fn change_player_score(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("change_player_score");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
        target: PlayerId,
        new_score: i64,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Moderator)
        ) {
            game.set_player_score(&target, new_score)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Player only: a player gave an answer (outside of the game)
pub async fn buzz(_: WampArgs, kwargs: WampKwArgs) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("buzz");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Player)
        ) {
            game.buzz(player_id)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Player only: a player submitted a wager
pub async fn submit_wager(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("buzz");
    wamp_kwargs!(kwargs, {
        game_id: GameId,
        player_id: PlayerId,
        auth: AuthToken,
        wager: i64,
    });

    {
        let games = STATE
            .games
            .try_read_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        let mut game = games
            .get(&game_id)
            .ok_or(Error::UnknownGame)?
            .try_write_for(OPERATION_TIMEOUT)
            .ok_or(Error::LockTimeout)?;

        if matches!(
            game.auth_and_get_player_type(&player_id, &auth),
            Some(PlayerType::Player)
        ) {
            game.submit_wager(wager)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}
