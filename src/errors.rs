use wamp_async::WampError;

/// General error enum.
#[derive(Debug)]
pub(crate) enum Error {
    Wamp(WampError),
    DataUrlDecode(Box<data_url::forgiving_base64::DecodeError<Error>>),
    DataUrlFormat(data_url::DataUrlError),
    DataUrlType,
    Io(std::io::Error),
    LockTimeout,
    UnknownGame,
    BadArgument,
    InvalidStateForOperation,
    InvalidSquareStateTransition,
    DailyDoubleWagerOutOfRange,
    FinalJeopardyWagerOutOfRange,
    NoSuchPlayer,
    NotAllowed,
    InvalidSquare,
    TooManyDailyDoubles,
    AvatarTooBig,
}
impl From<wamp_async::WampError> for Error {
    fn from(value: WampError) -> Self {
        Error::Wamp(value)
    }
}
impl From<data_url::forgiving_base64::DecodeError<Error>> for Error {
    fn from(value: data_url::forgiving_base64::DecodeError<Error>) -> Self {
        Error::DataUrlDecode(Box::new(value))
    }
}
impl From<data_url::DataUrlError> for Error {
    fn from(value: data_url::DataUrlError) -> Self {
        Error::DataUrlFormat(value)
    }
}
impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Error::Io(value)
    }
}
impl From<Error> for WampError {
    fn from(value: Error) -> WampError {
        use Error::*;

        WampError::UnknownError(
            match value {
                Wamp(we) => return we,
                DataUrlDecode(_) => "jpdy.data_url_decode",
                DataUrlFormat(_) => "jpdy.data_url_format",
                DataUrlType => "jpdy.avatar_data_type",
                Io(_) => "jpdy.io_error",
                LockTimeout => "jpdy.lock_timeout",
                UnknownGame => "jpdy.unknown_error",
                BadArgument => "jpdy.bad_argument",
                InvalidStateForOperation => "jpdy.invalid_game_state",
                InvalidSquareStateTransition => "jpdy.invalid_square_state_transition",
                DailyDoubleWagerOutOfRange | Error::FinalJeopardyWagerOutOfRange => {
                    "jpdy.wager_out_of_range"
                }
                NoSuchPlayer => "jpdy.no_such_player",
                NotAllowed => "jpdy.not_allowed",
                InvalidSquare => "jpdy.invalid_square",
                TooManyDailyDoubles => "jpdy.too_many_daily_doubles",
                AvatarTooBig => "jpdy.avatar_too_big",
            }
            .into(),
        )
    }
}
