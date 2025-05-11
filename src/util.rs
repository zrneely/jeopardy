#[macro_export]
macro_rules! wamp_dict {
    { } => {
        ::wamp_async::WampKwArgs::new()
    };
    { $( $name:expr => $val:expr , )* } => {
        {
            let mut map = ::wamp_async::WampKwArgs::new();
            $(
                map.insert(
                    $name.into(),
                    ::wamp_async::WampPayloadValue::String($val),
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
