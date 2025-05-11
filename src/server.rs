use log::*;
use wamp_async::{WampArgs, WampError, WampKwArgs, WampPayloadValue};

use crate::{
    errors::Error,
    game::{
        board::{Location, SquareState},
        AnswerType, FinalJeopardyInfoType, Player, PlayerType,
    },
    seed::Seed,
    AuthToken, GameId, Message, PlayerId, AVATAR_MANAGER, GAME_LOBBY_CHANNEL, MSG_QUEUE,
    OPERATION_TIMEOUT, STATE,
};

fn get_str_parse<T: std::str::FromStr>(arg: &WampPayloadValue) -> Result<T, Error> {
    let string = get_str(arg)?;
    string.parse().map_err(|_| Error::BadArgument)
}

fn get_str(arg: &WampPayloadValue) -> Result<&str, Error> {
    match arg {
        WampPayloadValue::String(ref string) => Ok(string),
        _ => Err(Error::BadArgument),
    }
}

fn get_uuid(arg: &WampPayloadValue) -> Result<uuid::Uuid, Error> {
    let string = get_str(arg)?;
    uuid::Uuid::parse_str(string).map_err(|_| Error::BadArgument)
}

fn get_common_args(
    kwargs: &wamp_async::WampKwArgs,
) -> Result<(GameId, PlayerId, AuthToken), Error> {
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
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("make_game");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let player_name = get_str(kwargs.get("player_name").ok_or(Error::BadArgument)?)?;
    let avatar_url = AVATAR_MANAGER
        .lock()
        .await
        .save_avatar(get_str(kwargs.get("avatar").ok_or(Error::BadArgument)?)?)
        .await?;

    let (game_id, player_id, auth_token, moderator_channel) =
        STATE.add_game(player_name.to_string(), avatar_url)?;

    trace!(
        "Creating game {} with moderator named {} (assigned mod channel: {:?})",
        game_id.0.hyphenated(),
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
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    debug!("join_game");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let player_name = get_str(kwargs.get("player_name").ok_or(Error::BadArgument)?)?;
    let game_id = GameId(get_uuid(kwargs.get("game_id").ok_or(Error::BadArgument)?)?);
    let avatar_url = AVATAR_MANAGER
        .lock()
        .await
        .save_avatar(get_str(kwargs.get("avatar").ok_or(Error::BadArgument)?)?)
        .await?;

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

        let player = Player::new(player_name.to_string(), avatar_url);
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

pub async fn leave_game(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    debug!("leave_game");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let target = PlayerId(get_uuid(kwargs.get("target").ok_or(Error::BadArgument)?)?);

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

        match game.auth_and_get_player_type(&player_id, &auth) {
            Some(PlayerType::Moderator) => {
                game.remove_player(target);
            }
            Some(PlayerType::Player) if player_id == target => {
                game.remove_player(target);
            }
            _ => return Err(Error::NotAllowed.into()),
        }
    }

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

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Get the list of open games.
pub async fn get_games(
    _: Option<WampArgs>,
    _: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("get_games");
    Ok((None, Some(STATE.get_games()?)))
}

/// Get the state for one game.
pub async fn get_game_state(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
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
        Some(PlayerType::Moderator) => Ok((None, Some(game.serialize(true)))),
        Some(PlayerType::Player) | None => Ok((None, Some(game.serialize(false)))),
    }
}

/// Moderator only: end a game
pub async fn end_game(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
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
    MSG_QUEUE
        .get()
        .unwrap()
        .send(Message {
            topic: GAME_LOBBY_CHANNEL.into(),
            args: None,
            kwargs: Some(STATE.get_games()?),
        })
        .unwrap();

    Ok((None, None))
}

/// Moderator only: select a square
pub async fn select_square(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
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
pub async fn answer(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("answer");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let answer: AnswerType = get_str_parse(kwargs.get("answer").ok_or(Error::BadArgument)?)?;

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
            game.answer(answer)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: change to a fresh board
pub async fn new_board(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("new_board");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let multiplier: i64 = get_str_parse(kwargs.get("multiplier").ok_or(Error::BadArgument)?)?;
    let daily_doubles: usize =
        get_str_parse(kwargs.get("daily_doubles").ok_or(Error::BadArgument)?)?;
    let categories: usize = get_str_parse(kwargs.get("categories").ok_or(Error::BadArgument)?)?;
    let seed: Seed = if let Some(WampPayloadValue::String(arg)) = kwargs.get("seed") {
        arg.parse().unwrap_or_else(|_| Seed::new_random())
    } else {
        Seed::new_random()
    };
    let min_year = get_str_parse(kwargs.get("min_year").ok_or(Error::BadArgument)?)?;
    let max_year = get_str_parse(kwargs.get("max_year").ok_or(Error::BadArgument)?)?;

    trace!(
        "new_board: multiplier: {}, daily doubles: {}, min_year: {}, max_year: {}, seed: {}",
        multiplier,
        daily_doubles,
        min_year,
        max_year,
        seed
    );

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
            game.load_new_board(
                multiplier,
                daily_doubles,
                categories,
                min_year,
                max_year,
                seed,
            )?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: start final jeopardy
pub async fn start_final_jeopardy(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("start_final_jeopardy");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let seed: Seed = if let Some(WampPayloadValue::String(arg)) = kwargs.get("seed") {
        arg.parse().unwrap_or_else(|_| Seed::new_random())
    } else {
        Seed::new_random()
    };
    let min_year = get_str_parse(kwargs.get("min_year").ok_or(Error::BadArgument)?)?;
    let max_year = get_str_parse(kwargs.get("max_year").ok_or(Error::BadArgument)?)?;

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
            game.start_final_jeopardy(seed, min_year, max_year)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: reveal the final jeopardy question
pub async fn reveal_final_jeopardy_question(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("reveal_final_jeopardy_question");

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
            game.reveal_final_jeopardy_question()?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: lock final jeopardy answers
pub async fn lock_final_jeopardy_answers(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("lock_final_jeopardy_answers");

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
            game.lock_final_jeopardy_answers()?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: reveal a player's final jeopardy info
pub async fn reveal_final_jeopardy_info(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("reveal_final_jeopardy_info");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let target_id: PlayerId = PlayerId(get_uuid(kwargs.get("target").ok_or(Error::BadArgument)?)?);
    let info_type: FinalJeopardyInfoType =
        get_str_parse(kwargs.get("info_type").ok_or(Error::BadArgument)?)?;

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
            game.reveal_final_jeopardy_info(&target_id, info_type)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: evaluate a player's final jeopardy answer
pub async fn evaluate_final_jeopardy_answer(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("reveal_final_jeopardy_info");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let target_id: PlayerId = PlayerId(get_uuid(kwargs.get("target").ok_or(Error::BadArgument)?)?);
    let answer: AnswerType = get_str_parse(kwargs.get("answer").ok_or(Error::BadArgument)?)?;

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
            game.evaluate_final_jeopardy_answer(&target_id, answer)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Moderator only: change a square's state
pub async fn change_square_state(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
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
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
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

/// Moderator only: enable the buzzer after selecting a square
pub async fn enable_buzzer(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("enable_buzzer");
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
            game.enable_buzzer()?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

/// Player only: a player gave an answer (outside of the game)
pub async fn buzz(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
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
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("submit_wager");
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
            game.submit_wager(&player_id, wager)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}

pub async fn submit_final_jeopardy_answer(
    _: Option<WampArgs>,
    kwargs: Option<WampKwArgs>,
) -> Result<(Option<WampArgs>, Option<WampKwArgs>), WampError> {
    info!("submit_final_jeopardy_answer");

    let kwargs = kwargs.ok_or(Error::BadArgument)?;
    let (game_id, player_id, auth) = get_common_args(&kwargs)?;
    let answer: &str = get_str(kwargs.get("answer").ok_or(Error::BadArgument)?)?;

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
            game.submit_final_jeopardy_answer(&player_id, answer)?;
        } else {
            return Err(Error::NotAllowed.into());
        }
    }

    STATE.broadcast_game_state_update(&game_id).await?;
    Ok((None, None))
}
