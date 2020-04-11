use crate::GameId;

#[macro_export]
macro_rules! wamp_dict {
    { } => {
        ::std::collections::HashMap::new()
    };
    { $( $name:expr => $val:expr , )* } => {
        {
            let mut map = ::std::collections::HashMap::<String, _>::new();
            $(
                map.insert(
                    $name.into(),
                    ::wamp_async::Arg::String($val),
                );
            )*
            map
        }
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

pub(crate) fn get_state_channel(game_id: &GameId) -> String {
    format!("jpdy.chan.game.{}.sys", game_id.0.to_hyphenated())
}

pub(crate) fn get_chat_channel(game_id: &GameId) -> String {
    format!("jpdy.chan.game.{}.chat", game_id.0.to_hyphenated())
}
