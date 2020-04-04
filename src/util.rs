use crate::{game::Player, GameId};

use std::ops::{Index, IndexMut};

#[macro_export]
macro_rules! wamp_dict {
    { } => {
        ::std::collections::HashMap::new()
    };
    { $( $name:expr => $val:expr , )* } => {
        {
            let mut map = ::std::collections::HashMap::new();
            $(
                map.insert(
                    $name.into(),
                    ::wamp_async::Arg::String(
                        ::serde_json::to_string(&$val).map_err(
                            <serde_json::error::Error as Into<crate::errors::Error>>::into)?
                    )
                );
            )*
            map
        }
    };
}

#[macro_export]
macro_rules! wamp_kwargs {
    ( $arglist:expr , {  $( $name:ident : $type:ty , )* } ) => {
        let args = $arglist.ok_or_else(||
            ::wamp_async::WampError::UnknownError("expected kwargs".into()))?;

        $(
            let $name: $type = match args.get(stringify!($name)) {
                Some(&::wamp_async::Arg::Uri(ref val)) => {
                    ::serde_json::from_str(val).map_err(|json_err| {
                        warn!("Failed to parse kwarg {}: {:?}", stringify!($name), json_err);
                        ::wamp_async::WampError::UnknownError(
                            concat!("failed to parse kwarg ", stringify!($name)).into())
                    })?
                }
                _ => return Err(::wamp_async::WampError::UnknownError(
                    concat!("missing expected arg ", stringify!($name)).into())),
            };
        )*
    };
}

#[macro_export]
macro_rules! rpc_register {
    ( $client:expr , { $( $name:expr => $fn:expr , )* } ) => {
        {
            let results: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = _>>>> = vec![
                $(
                    {
                        debug!("Registering {} to {}...", stringify!($fn), $name);
                        Box::pin($client.register($name, $fn))
                    },
                )*
            ];
            ::futures::future::join_all(results)
        }
    };
}

macro_rules! mutate_game {
    ( $game:ident = $global:ident [ $id:expr ] , $who:expr , $auth:expr , $code:block ) => {{
        let global = $global
            .games
            .try_read_for(crate::OPERATION_TIMEOUT)
            .ok_or(crate::errors::Error::LockTimeout)?;

        let res = {
            let mut running_game = global
                .get(&$id)
                .ok_or(crate::errors::Error::UnknownGame)?
                .try_write_for(crate::OPERATION_TIMEOUT)
                .ok_or(crate::errors::Error::LockTimeout)?;

            if running_game.get_player_token($who) != $auth {
                return Err(crate::errors::Error::BadAuth.into());
            }

            let $game = &mut running_game.state;

            $code
        };

        parking_lot::RwLockReadGuard::unlock_fair(global);
        res
    }};
}

pub(crate) fn get_state_channel(game_id: &GameId) -> String {
    format!("ontm.chan.game.{}.sys", game_id.0.to_hyphenated())
}

pub(crate) fn get_chat_channel(game_id: &GameId) -> String {
    format!("ontm.chan.game.{}.chat", game_id.0.to_hyphenated())
}

// Data which exists for both players.
#[derive(Debug)]
pub(crate) struct PlayerData<T> {
    pub white: T,
    pub black: T,
}
impl<T> Index<Player> for PlayerData<T> {
    type Output = T;

    fn index(&self, index: Player) -> &Self::Output {
        match index {
            Player::White => &self.white,
            Player::Black => &self.black,
        }
    }
}
impl<T> IndexMut<Player> for PlayerData<T> {
    fn index_mut(&mut self, index: Player) -> &mut Self::Output {
        match index {
            Player::White => &mut self.white,
            Player::Black => &mut self.black,
        }
    }
}
impl<T: Default> Default for PlayerData<T> {
    fn default() -> Self {
        PlayerData {
            white: T::default(),
            black: T::default(),
        }
    }
}
impl<T> PlayerData<Option<T>> {
    pub fn get_missing(&self) -> Option<Player> {
        if self.white.is_none() {
            Some(Player::White)
        } else if self.black.is_none() {
            Some(Player::Black)
        } else {
            None
        }
    }
}
