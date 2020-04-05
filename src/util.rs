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
                    ::wamp_async::Arg::String(
                        ::serde_json::to_string(&$val).expect("Failed to serialize!")
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

pub(crate) fn get_state_channel(game_id: &GameId) -> String {
    format!("jpdy.chan.game.{}.sys", game_id.0.to_hyphenated())
}

pub(crate) fn get_chat_channel(game_id: &GameId) -> String {
    format!("jpdy.chan.game.{}.chat", game_id.0.to_hyphenated())
}
