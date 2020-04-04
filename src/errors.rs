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
            Error::LockTimeout => WampError::UnknownError("jpdy.lock_timeout".into()),
            Error::UnknownGame => WampError::UnknownError("jpdy.unknown_error".into()),
            Error::SerdeJson(_) => WampError::UnknownError("jpdy.json_error".into()),
            Error::BadArgument => WampError::UnknownError("jpdy.bad_argument".into()),
            Error::BadAuth => WampError::UnknownError("jpdy.bad_auth".into()),
            Error::IllegalMove => WampError::UnknownError("jpdy.illegal_move".into()),
            Error::GameFull => WampError::UnknownError("jpdy.game_is_full".into()),
        }
    }
}
