use std::collections::HashMap;

use log::*;
use wamp_async::{Arg, WampArgs, WampError, WampKwArgs};

use crate::{
    errors::Error,
    game::{Location, Player, PlayerType, SquareState},
    AuthToken, GameId, Message, PlayerId, Seed, GAME_LOBBY_CHANNEL, MSG_QUEUE, OPERATION_TIMEOUT,
    STATE,
};

fn get_str_parse<T: std::str::FromStr>(arg: &Arg) -> Result<T, Error> {
    let string = get_str(arg)?;
    string.parse().map_err(|_| Error::BadArgument)
}

fn get_str(arg: &Arg) -> Result<&str, Error> {
    match arg {
        Arg::Uri(ref string) | Arg::String(ref string) => Ok(string),
        _ => Err(Error::BadArgument),
    }
}

fn get_uuid(arg: &Arg) -> Result<uuid::Uuid, Error> {
    let string = get_str(arg)?;
    uuid::Uuid::parse_str(string).map_err(|_| Error::BadArgument)
}

fn get_common_args(kwargs: &HashMap<String, Arg>) -> Result<(GameId, PlayerId, AuthToken), Error> {
    Ok((
        GameId(get_uuid(kwargs.get("game_id").ok_or(Error::BadArgument)?)?),
        PlayerId(get_uuid(
            kwargs.get("player_id").ok_or(Error::BadArgument)?,
        )?),
        AuthToken(get_uuid(kwargs.get("auth").ok_or(Error::BadArgument)?)?),
    ))
}

/// Create a new game and add it to the state.
pub async fn make_game(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("make_game");

    let player_name = get_str(
        kwargs
            .as_ref()
            .ok_or(Error::BadArgument)?
            .get("player_name")
            .ok_or(Error::BadArgument)?,
    )?;

    let (game_id, player_id, auth_token, moderator_channel) =
        STATE.add_game(player_name.to_string())?;

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
            "game_id" => game_id.to_string(),         // A unique game ID
            "token" => auth_token.to_string(),        // The player's auth token
            "player_id" => player_id.to_string(),     // The player's ID
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

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let player_name = get_str(kwargs.get("player_name").ok_or(Error::BadArgument)?)?;
    let game_id = GameId(get_uuid(kwargs.get("game_id").ok_or(Error::BadArgument)?)?);

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

        let player = Player::new(player_name.to_string());
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

    // Update the players and moderator.
    STATE.broadcast_game_state_update(&game_id).await?;

    Ok((
        None,
        Some(wamp_dict! {
            "player_id" => player_id.to_string(),
            "token" => auth_token.to_string(),
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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;

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
        Some(PlayerType::Moderator) => Ok((None, Some(game.serialize_for_moderator()))),
        Some(PlayerType::Player) => Ok((None, Some(game.serialize_for_players()))),
        None => Err(Error::NoSuchPlayer.into()),
    }
}

/// Moderator only: end a game
pub async fn end_game(
    _: WampArgs,
    kwargs: WampKwArgs,
) -> Result<(WampArgs, WampKwArgs), WampError> {
    info!("end_game");
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;

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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let category: usize = get_str_parse(kwargs.get("category").ok_or(Error::BadArgument)?)?;
    let row: usize = get_str_parse(kwargs.get("row").ok_or(Error::BadArgument)?)?;

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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let correct: bool = get_str_parse(kwargs.get("correct").ok_or(Error::BadArgument)?)?;

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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    trace!("new_board: {} {}", game_id, player_id);
    let multiplier: i64 = get_str_parse(kwargs.get("multiplier").ok_or(Error::BadArgument)?)?;
    trace!("new_board: multiplier: {}", multiplier);
    let daily_doubles: usize =
        get_str_parse(kwargs.get("daily_doubles").ok_or(Error::BadArgument)?)?;
    let categories: usize = get_str_parse(kwargs.get("categories").ok_or(Error::BadArgument)?)?;
    let seed: Seed = if let Some(Arg::Uri(arg)) = kwargs.get("seed") {
        arg.parse().map_err(|_| Error::BadArgument)?
    } else {
        Seed::new_random()
    };

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
            game.load_new_board(multiplier, daily_doubles, categories, seed)?;
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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let category: usize = get_str_parse(kwargs.get("category").ok_or(Error::BadArgument)?)?;
    let row: usize = get_str_parse(kwargs.get("row").ok_or(Error::BadArgument)?)?;
    // true: ready; false: finished
    let new_state: bool = get_str_parse(kwargs.get("new_state").ok_or(Error::BadArgument)?)?;

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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let target = PlayerId(get_uuid(kwargs.get("target").ok_or(Error::BadArgument)?)?);
    let new_score: i64 = get_str_parse(kwargs.get("new_score").ok_or(Error::BadArgument)?)?;

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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;

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
    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let wager: i64 = get_str_parse(kwargs.get("wager").ok_or(Error::BadArgument)?)?;

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
