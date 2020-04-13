import autobahn from 'autobahn';
import React from 'react';
import { GameJoinInfo, ServerData, handleError } from './common';
import { Board } from './board';

enum Activity {
    Wait,
    Buzz,               // player only
    DailyDoubleWager,   // player only
    EvaluateAnswer,     // moderator only
}

interface GameState {
    isModerator: boolean,
    currentActivity: Activity,
    board: ServerData.Board,
    players: { [player_id: string]: ServerData.Player },
    controller: string | null, // player ID
}

export interface GameProps {
    session: autobahn.Session,
    joinInfo: GameJoinInfo,
    leaveGameCallback: () => void,
}

export class Game extends React.Component<GameProps, GameState> {
    state: GameState = {
        isModerator: false,
        currentActivity: Activity.Wait,
        board: this.getEmptyBoard(),
        players: {},
        controller: null,
    }

    private gameUpdateSubscription: autobahn.Subscription | null = null;

    constructor(props: GameProps) {
        super(props);

        this.loadNewState = this.loadNewState.bind(this);
        this.getEmptyBoard = this.getEmptyBoard.bind(this);
    }

    // Creates the fake board used for rendering when there's no board
    getEmptyBoard(): ServerData.Board {
        let categories: ServerData.Category[] = [];
        for (let i = 0; i < 6; i++) {
            let squares: ServerData.Square[] = [];

            for (let j = 0; j < 5; j++) {
                squares.push({
                    state: 'Normal',
                    clue: undefined,
                    answer: undefined,
                });
            }

            categories.push({
                title: `Category ${i}`,
                commentary: undefined,
                squares,
            });
        }

        return {
            value_multiplier: '200',
            categories: categories,
            daily_doubles: [],
            etag: 0,
            id: 0,
        };
    }

    getActivity(gameState: ServerData.RemoteGameState, isModerator: boolean): Activity {
        if (isModerator) {
            switch (gameState.type) {
                case 'NoBoard': return Activity.Wait;
                case 'WaitingForSquareSelection': return Activity.Wait;
                case 'WaitingForBuzzer': return Activity.Wait;
                case 'WaitingForDailyDoubleWager': return Activity.Wait;
                case 'WaitingForAnswer': return Activity.EvaluateAnswer;
                default: {
                    handleError('unknown game state', '', true);
                    return Activity.Wait;
                }
            }
        } else {
            switch (gameState.type) {
                case 'NoBoard': return Activity.Wait;
                case 'WaitingForSquareSelection': return Activity.Wait;
                case 'WaitingForBuzzer': return Activity.Buzz;
                case 'WaitingForDailyDoubleWager': return Activity.DailyDoubleWager;
                case 'WaitingForAnswer': return Activity.Wait;
                default: {
                    handleError('unknown game state', '', true);
                    return Activity.Wait;
                }
            }
        }
    }

    getController(gameState: ServerData.RemoteGameState): string | null {
        if (gameState.type === 'NoBoard') {
            return this.state.controller;
        } else {
            return gameState.controller;
        }
    }

    getBoard(gameState: ServerData.RemoteGameState): ServerData.Board {
        if (gameState.type === 'NoBoard') {
            return this.getEmptyBoard();
        } else {
            return gameState.board;
        }
    }

    // Looks at the state update from the server and converts it to a new GameState.
    loadNewState(update: ServerData.GameStateUpdate) {
        console.log('game state update from server');
        console.log(update);

        if (update.is_ended) {
            this.props.leaveGameCallback();
        }

        this.setState({
            board: this.getBoard(update.state),
            currentActivity: this.getActivity(update.state, update.is_moderator),
            isModerator: update.is_moderator,
            players: update.players,
            controller: this.getController(update.state),
        });
    }

    componentDidMount() {
        let initialState = this.props.session.call<autobahn.Result>('jpdy.game_state', [], {
            'game_id': this.props.joinInfo.gameId,
            'player_id': this.props.joinInfo.playerId,
            'auth': this.props.joinInfo.token,
        });

        let stateSubscription = this.props.session.subscribe(
            this.props.joinInfo.channel,
            (_, update) => {
                this.loadNewState(update.kwargs);
            });

        Promise.all([
            initialState, stateSubscription
        ]).then(([initialState, subscription]) => {
            this.gameUpdateSubscription = subscription;
            this.loadNewState(initialState.kwargs);
        }, (error) => {
            handleError('game subscription/setup failed', error, true);
        });
    }

    componentWillUnmount() {
        console.log('componentWillUnmount: Game');
        if (this.gameUpdateSubscription !== null) {
            this.props.session.unsubscribe(this.gameUpdateSubscription);
            this.gameUpdateSubscription = null;
        }
    }

    render() {
        return <div className="game">
            <div className="gameLeftPanel">
                <Board data={this.state.board} />
                <div className="gameControls">
                    TODO
                </div>
            </div>
            <div className="gameRightPanel">
                TODO
            </div>
        </div>;
    }
}

