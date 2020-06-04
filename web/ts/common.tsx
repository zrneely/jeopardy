export function handleError(msg: string, error: any, clearData: boolean) {
    console.error(`${msg}: ${JSON.stringify(error)}`);
    alert(msg);

    if (clearData) {
        localStorage.clear();
        location.reload();
    }
}

export interface GameJoinInfo {
    gameId: string,
    playerId: string,
    token: string,
    channel: string,
}

export enum Activity {
    Wait,
    Moderate,
    WaitForBuzz,
    WaitForDailyDoubleWager,
    Buzz,               // player only
    DailyDoubleWager,   // player only
    WaitForEval,        // player only
    EvaluateAnswer,     // moderator only
}

// Types that come from the server
export namespace ServerData {
    export interface OpenGame {
        game_id: string;
        moderator: string;  // name
        players: [string];  // names
    }

    export interface Player {
        name: string,
        score: string,
        avatar_url: string,
    }

    export interface GameStateUpdate {
        is_ended: boolean,
        players: { [player_id: string]: Player },
        state: RemoteGameState,
        is_moderator: boolean,
    }

    export enum SquareState {
        Normal = 'Normal',
        DailyDoubleRevealed = 'DailyDoubleRevealed',
        Flipped = 'Flipped',
        Finished = 'Finished',
    }

    export enum AnswerType {
        Correct = 'Correct',
        Incorrect = 'Incorrect',
        Skip = 'Skip',
    }

    export interface Square {
        state: SquareState,
        clue: Clue | undefined,
        answer: string | undefined,
        is_daily_double: boolean | undefined,
    }

    export interface Clue {
        text: string | undefined,
        link: string | undefined,
    }

    export interface Category {
        title: string,
        air_year: string,
        commentary: string | undefined,
        squares: Square[],
    }

    export interface Board {
        value_multiplier: string,
        categories: Category[],
        etag: number,
        id: number,
        seed: string,
    }

    export interface BoardLocation {
        category: number,
        row: number,
    }

    export interface NoBoard {
        type: 'NoBoard',
    }

    export interface WaitingForSquareSelection {
        type: 'WaitingForSquareSelection',
        board: Board,
        controller: string | undefined,
    }

    export interface WaitingForDailyDoubleWager {
        type: 'WaitingForDailyDoubleWager',
        board: Board,
        controller: string,
        location: BoardLocation,
    }

    export interface WaitingForBuzzer {
        type: 'WaitingForBuzzer',
        board: Board,
        controller: string,
        location: BoardLocation,
    }

    export interface WaitingForAnswer {
        type: 'WaitingForAnswer',
        board: Board,
        controller: string,
        location: BoardLocation,
        active_player: string,
    }

    export type RemoteGameState =
        NoBoard |
        WaitingForSquareSelection |
        WaitingForDailyDoubleWager |
        WaitingForBuzzer |
        WaitingForAnswer;
}