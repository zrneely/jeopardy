function handleError(msg: string, error: any) {
    console.log(`${msg}: ${JSON.stringify(error)}`);
    alert(msg);
}

// Types that come from the server
namespace ServerData {
    export interface OpenGame {
        game_id: string;
        moderator: string;  // name
        players: [string];  // names
    }

    export interface Player {
        name: string,
        score: string,
    }

    export interface GameStateUpdate {
        is_ended: boolean,
        players: { [player_id: string]: Player },
        state: any, // could eventaully make this strongly typed
        is_moderator: boolean,
    }
}