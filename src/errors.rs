use wamp_async::WampError;

/// General error enum.
#[derive(Debug)]
pub(crate) enum Error {
    Wamp(WampError),
    LockTimeout,
    UnknownGame,
    BadArgument,
    InvalidStateForOperation,
    InvalidSquareStateTransition,
    DailyDoubleWagerOutOfRange,
    NoSuchPlayer,
    NotAllowed,
    InvalidSquare,
    TooManyDailyDoubles,
}
impl From<wamp_async::WampError> for Error {
    fn from(value: WampError) -> Self {
        Error::Wamp(value)
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
                BadArgument => "jpdy.bad_argument",
                InvalidStateForOperation => "jpdy.invalid_game_state",
                InvalidSquareStateTransition => "jpdy.invalid_square_state_transition",
                DailyDoubleWagerOutOfRange => "jpdy.wager_out_of_range",
                NoSuchPlayer => "jpdy.no_such_player",
                NotAllowed => "jpdy.not_allowed",
                InvalidSquare => "jpdy.invalid_square",
                TooManyDailyDoubles => "jpdy.too_many_daily_doubles",
            }
            .into(),
        )
    }
}
