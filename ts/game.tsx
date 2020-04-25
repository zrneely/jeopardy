import autobahn from 'autobahn';
import React from 'react';
import { GameJoinInfo, ServerData, handleError, Activity } from './common';
import { Board } from './board';
import { ModeratorControls } from './controls';

interface GameState {
    isModerator: boolean,
    currentActivity: Activity,
    board: ServerData.Board,
    players: { [player_id: string]: ServerData.Player },
    controller: string | null, // player ID
    activePlayer: string | null, // player ID
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
        activePlayer: null,
    }

    private gameUpdateSubscription: autobahn.Subscription | null = null;

    constructor(props: GameProps) {
        super(props);

        this.loadNewState = this.loadNewState.bind(this);
        this.getEmptyBoard = this.getEmptyBoard.bind(this);
        this.newBoardClicked = this.newBoardClicked.bind(this);
        this.boardSquareClicked = this.boardSquareClicked.bind(this);
        this.evalAnswerClicked = this.evalAnswerClicked.bind(this);
    }

    // Creates the fake board used for rendering when there's no board
    getEmptyBoard(): ServerData.Board {
        let categories: ServerData.Category[] = [];
        for (let i = 0; i < 6; i++) {
            let squares: ServerData.Square[] = [];

            for (let j = 0; j < 5; j++) {
                squares.push({
                    state: ServerData.SquareState.Normal,
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
            value_multiplier: '1',
            categories: categories,
            daily_doubles: [],
            etag: 0,
            id: -1,
            seed: '',
        };
    }

    getActivity(gameState: ServerData.RemoteGameState, isModerator: boolean): Activity {
        if (isModerator) {
            switch (gameState.type) {
                case 'NoBoard': return Activity.Moderate;
                case 'WaitingForSquareSelection': return Activity.Moderate;
                case 'WaitingForBuzzer': return Activity.WaitForBuzz;
                case 'WaitingForDailyDoubleWager': return Activity.WaitForDailyDoubleWager;
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
            return gameState.controller || null;
        }
    }

    getActivePlayer(gameState: ServerData.RemoteGameState): string | null {
        if (gameState.type === 'WaitingForAnswer') {
            return gameState.active_player;
        } else {
            return null;
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
            activePlayer: this.getActivePlayer(update.state),
        });
    }

    newBoardClicked(seed: string | null, dailyDoubles: number, multiplier: number) {
        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
            multiplier: `${multiplier}`,
            daily_doubles: `${dailyDoubles}`,
            categories: '6',
        };
        if (seed !== null) {
            argument['seed'] = seed;
        }

        this.props.session.call('jpdy.new_board', [], argument).then(() => {
            console.log('new board call succeeded!');
        }, (error) => {
            handleError('new board call failed', error, false);
        });
    }

    boardSquareClicked(location: ServerData.BoardLocation) {
        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
            category: location.category.toString(),
            row: location.row.toString(),
        };

        this.props.session.call('jpdy.select_square', [], argument).then(() => {
            console.log('select square call succeededd!');
        }, (error) => {
            handleError('select square call failed', error, false);
        });
    }

    evalAnswerClicked(answer: ServerData.AnswerType) {
        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
            answer,
        };

        this.props.session.call('jpdy.answer', [], argument).then(() => {
            console.log('answer call succeeded!');
        }, (error) => {
            handleError('answer call failed', error, false);
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
                this.loadNewState(update);
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
        let controllerName;
        if (this.state.controller === null) {
            controllerName = null;
        } else {
            controllerName = this.state.players[this.state.controller].name;
        }

        let activeName;
        if (this.state.activePlayer === null) {
            activeName = null;
        } else {
            activeName = this.state.players[this.state.activePlayer].name;
        }

        return <div className="game">
            <div className="game-left-panel">
                <Board
                    data={this.state.board}
                    isModerator={this.state.isModerator}
                    squareClickedCallback={this.boardSquareClicked} />
                <ModeratorControls
                    activity={this.state.currentActivity}
                    controllingPlayer={controllerName}
                    activePlayer={activeName}
                    seed={this.state.board.seed}
                    isBoardLoaded={this.state.board.id !== -1}
                    newBoardClicked={this.newBoardClicked}
                    evalButtonClicked={this.evalAnswerClicked} />
            </div>
            <div className="game-right-panel">
                TODO
            </div>
        </div>;
    }
}

