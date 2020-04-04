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
    IllegalMove,
    GameFull,
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
        match value {
            Error::Wamp(we) => we,
            Error::LockTimeout => WampError::UnknownError("ontm.lock_timeout".into()),
            Error::UnknownGame => WampError::UnknownError("ontm.unknown_error".into()),
            Error::SerdeJson(_) => WampError::UnknownError("ontm.json_error".into()),
            Error::BadArgument => WampError::UnknownError("ontm.bad_argument".into()),
            Error::BadAuth => WampError::UnknownError("ontm.bad_auth".into()),
            Error::IllegalMove => WampError::UnknownError("ontm.illegal_move".into()),
            Error::GameFull => WampError::UnknownError("ontm.game_is_full".into()),
        }
    }
}
