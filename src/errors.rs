use wamp_async::WampError;

/// General error enum.
#[derive(Debug)]
pub(crate) enum Error {
    Wamp(WampError),
    LockTimeout,
    UnknownGame,
    SerdeJson(serde_json::Error),
    BadArgument,
    BadAuth,
    NoLoadedBoard,
    InvalidStateForOperation,
    InvalidSquareStateTransition,
    DailyDoubleWagerTooSmall,
    NoSuchPlayer,
}
impl From<wamp_async::WampError> for Error {
    fn from(value: WampError) -> Self {
        Error::Wamp(value)
    }
}
impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Error::SerdeJson(value)
    }
}
impl From<Error> for WampError {
    fn from(value: Error) -> WampError {
        use Error::*;

        WampError::UnknownError(
            match value {
                Wamp(we) => return we,
                LockTimeout => "jpdy.lock_timeout",
                UnknownGame => "jpdy.unknown_error",
                SerdeJson(_) => "jpdy.json_error",
                BadArgument => "jpdy.bad_argument",
                BadAuth => "jpdy.bad_auth",
                NoLoadedBoard => "jpdy.no_board",
                InvalidStateForOperation => "jpdy.invalid_game_state",
                InvalidSquareStateTransition => "jpdy.invalid_square_state_transition",
                DailyDoubleWagerTooSmall => "jpdy.wager_too_small",
                NoSuchPlayer => "jpdy.no_such_player",
            }
            .into(),
        )
    }
}
