import React from 'react';
import autobahn from 'autobahn';

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
export const LS_KEY_CUR_GAME = "curGame";

export function handleError(msg: string, error: any, clearData: boolean) {
    console.error(`${msg}: ${JSON.stringify(error)}`);
    alert(msg);

    if (clearData) {
        localStorage.removeItem(LS_KEY_CUR_GAME);
        location.reload();
    }
}

export enum EventNames {
    StartTimer = 'StartTimer',
    StopTimer = 'StopTimer',
}

export interface GlobalMetadata {
    minCategoryYear: number | null,
    maxCategoryYear: number | null,
    session: autobahn.Session | null;
    joinInfo: GameJoinInfo | null;
}

export interface JeopardyContextType extends GlobalMetadata {
    withSession(callback: (session: autobahn.Session, argument: { [key: string]: string; }) => void): void,
    fireEvent(name: string): void,
    listenEvent(name: string, callback: () => void): number,
    unlistenEvent(name: string, id: number): void,
}

interface EventHandlerList {
    map: { [id: string]: () => void; },
    nextId: number,
}
export class JeopardyContextClass implements JeopardyContextType {
    session: autobahn.Session | null;
    joinInfo: GameJoinInfo | null;
    minCategoryYear: number | null;
    maxCategoryYear: number | null;

    eventHandlers: { [name: string]: EventHandlerList; };

    constructor(
        session: autobahn.Session | null,
        joinInfo: GameJoinInfo | null,
        minCategoryYear: number | null,
        maxCategoryYear: number | null,
    ) {
        this.session = session;
        this.joinInfo = joinInfo;
        this.minCategoryYear = minCategoryYear;
        this.maxCategoryYear = maxCategoryYear;
        this.eventHandlers = {};
    }

    fireEvent(name: string) {
        if (this.eventHandlers.hasOwnProperty(name)) {
            Object.keys(this.eventHandlers[name].map).forEach((id) => {
                setTimeout(() => this.eventHandlers[name].map[id](), 0);
            });
        }
    }

    listenEvent(name: string, callback: () => void): number {
        if (!this.eventHandlers.hasOwnProperty(name)) {
            this.eventHandlers[name] = {
                map: {},
                nextId: 0,
            };
        }

        const id = this.eventHandlers[name].nextId;
        this.eventHandlers[name].map[id] = callback;
        this.eventHandlers[name].nextId += 1;
        return id;
    }

    unlistenEvent(name: string, id: number) {
        if (this.eventHandlers.hasOwnProperty(name) && this.eventHandlers[name].hasOwnProperty(id)) {
            delete this.eventHandlers[name].map[id];
        }
    }

    withSession(callback: (session: autobahn.Session, argument: { [key: string]: string; }) => void) {
        if (this.session !== null && this.joinInfo !== null) {
            if (this.joinInfo.token !== null) {
                callback(this.session, {
                    game_id: this.joinInfo.gameId,
                    player_id: this.joinInfo.playerId!, // if token is non-null, so is player ID
                    auth: this.joinInfo.token,
                });
            } else {
                callback(this.session, {
                    game_id: this.joinInfo.gameId,
                    player_id: EMPTY_GUID,
                    auth: EMPTY_GUID,
                });
            }
        } else {
            handleError('session closed', null, false);
        }
    }
}

export const JeopardyContext = React.createContext<JeopardyContextType>(
    new JeopardyContextClass(null, null, null, null));

export interface GameJoinInfo {
    gameId: string,
    playerId: string | null,
    token: string | null,
    channel: string,
}

export enum Activity {
    Wait,
    WaitForBuzz,
    WaitForDailyDoubleWager,
    FinalJeopardy,

    // Player only
    Buzz,
    DailyDoubleWager,
    WaitForEval,

    // Moderator only
    Moderate,
    EnableBuzzer,
    EvaluateAnswer,
}

// Types that come from the server
export namespace ServerData {
    export interface OpenGame {
        game_id: string;
        moderator: string;  // name
        players: string[];  // names
        channel: string,
    }

    export interface FinalJeopardyInfo {
        wager: string | undefined,
        wager_revealed: boolean | undefined,
        answer: string | null | undefined, // null -> no answer yet; undefined -> we aren't allowed to see yet
        answer_revealed: boolean | undefined,
    }

    export interface Player {
        name: string,
        score: string,
        avatar_url: string,
        final_jeopardy_info: FinalJeopardyInfo,
    }

    export interface GameStateUpdate {
        is_ended: boolean,
        players: { [player_id: string]: Player; },
        state: RemoteGameState,
        is_moderator: boolean,
        moderator: string, // name
        min_year: number,
        max_year: number,
    }

    export enum FinalJeopardyInfoType {
        Wager = 'Wager',
        Answer = 'Answer',
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
        air_year: number,
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

    export interface WaitingForEnableBuzzer {
        type: 'WaitingForEnableBuzzer',
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

    export interface FinalJeopardy {
        type: 'FinalJeopardy',
        category: string,
        air_year: number,
        answers_locked: boolean,
        question_revealed: boolean,
        question: Clue | undefined,
        answer: string | undefined,
    }

    export type RemoteGameState =
        NoBoard |
        WaitingForSquareSelection |
        WaitingForDailyDoubleWager |
        WaitingForEnableBuzzer |
        WaitingForBuzzer |
        WaitingForAnswer |
        FinalJeopardy;
}

export interface ConfigData {
    routerUrl: string,
    gaIdentifier: string | undefined,
    gaSampleRate: number | undefined,
    debug: boolean | undefined,
}