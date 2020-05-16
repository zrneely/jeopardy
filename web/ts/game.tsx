import autobahn from 'autobahn';
import React from 'react';
import { GameJoinInfo, ServerData, handleError, Activity } from './common';
import { Board } from './board';
import { ModeratorControls, PlayerControls, ControlPanel } from './controls';
import { PlayersList } from './players';

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
    private controlPanel: React.RefObject<ControlPanel> = React.createRef();

    constructor(props: GameProps) {
        super(props);

        this.loadNewState = this.loadNewState.bind(this);
        this.getEmptyBoard = this.getEmptyBoard.bind(this);
        this.newBoardClicked = this.newBoardClicked.bind(this);
        this.boardSquareClicked = this.boardSquareClicked.bind(this);
        this.dailyDoubleWagerSubmitted = this.dailyDoubleWagerSubmitted.bind(this);
        this.evalAnswerClicked = this.evalAnswerClicked.bind(this);
        this.buzzClicked = this.buzzClicked.bind(this);
        this.adjustScore = this.adjustScore.bind(this);
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
                    is_daily_double: undefined,
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
            categories,
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
                case 'WaitingForAnswer': return Activity.WaitForEval;
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
        if (!this.state.isModerator) {
            return;
        }

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

    dailyDoubleWagerSubmitted(wager: number) {
        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
            wager: wager.toString(),
        };

        this.props.session.call('jpdy.submit_wager', [], argument).then(() => {
            console.log('submit wager call succeeded!');

            if (this.controlPanel.current !== null) {
                this.controlPanel.current.startTimer();
            }
        }, (error) => {
            handleError('submit wager call failed', error, false);
        })
    }

    evalAnswerClicked(answer: ServerData.AnswerType) {
        if (!this.state.isModerator) {
            return;
        }

        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
            answer,
        };

        this.props.session.call('jpdy.answer', [], argument).then(() => {
            console.log('answer call succeeded!');

            if (this.controlPanel.current !== null) {
                this.controlPanel.current.stopTimer();
            }
        }, (error) => {
            handleError('answer call failed', error, false);
        });
    }

    buzzClicked() {
        if (this.state.isModerator) {
            return;
        }

        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
        };

        this.props.session.call('jpdy.buzz', [], argument).then(() => {
            console.log('buzz succeeded!');
        }, (error) => {
            handleError('buzz failed', error, false);
        });
    }

    adjustScore(targetPlayerId: string, newScore: number) {
        if (!this.state.isModerator) {
            return;
        }

        let argument: { [k: string]: string } = {
            game_id: this.props.joinInfo.gameId,
            player_id: this.props.joinInfo.playerId,
            auth: this.props.joinInfo.token,
            target: targetPlayerId,
            new_score: newScore.toString(),
        };

        this.props.session.call('jpdy.change_player_score', [], argument).then(() => {
            console.log('change_player_score call succeeded!');
        }, (error) => {
            handleError('change_player_score call failed', error, false);
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
        if (this.gameUpdateSubscription !== null) {
            this.props.session.unsubscribe(this.gameUpdateSubscription);
            this.gameUpdateSubscription = null;
        }
    }

    // Used to start/stop timers triggered by remote actions
    componentDidUpdate(_: any, prevState: GameState) {
        if (this.controlPanel.current !== null) {
            // If we're a player and the moderator evaluated an answer,
            // stop the timer.
            if ((prevState.currentActivity === Activity.WaitForEval) &&
                (this.state.currentActivity !== Activity.WaitForEval)) {

                this.controlPanel.current.stopTimer();
            }

            // If we're a moderator and the player submitted their daily double
            // wager, start the timer.
            if ((prevState.currentActivity === Activity.WaitForDailyDoubleWager) &&
                (this.state.currentActivity === Activity.EvaluateAnswer)) {

                this.controlPanel.current.startTimer();
            }
        }
    }

    isModeratorControl(
        _item: React.RefObject<ControlPanel>
    ): _item is React.RefObject<ModeratorControls> {
        return this.state.isModerator;
    }

    isPlayerControl(
        _item: React.RefObject<ControlPanel>
    ): _item is React.RefObject<PlayerControls> {
        return !this.state.isModerator;
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

        let controls;
        if (this.isModeratorControl(this.controlPanel)) {
            controls = <ModeratorControls
                ref={this.controlPanel}
                activity={this.state.currentActivity}
                controllingPlayer={controllerName}
                activePlayer={activeName}
                seed={this.state.board.seed}
                isBoardLoaded={this.state.board.id !== -1}
                newBoardClicked={this.newBoardClicked}
                evalButtonClicked={this.evalAnswerClicked}
                buzzerClicked={this.buzzClicked} />;
        } else if (this.isPlayerControl(this.controlPanel)) {
            controls = <PlayerControls
                ref={this.controlPanel}
                activity={this.state.currentActivity}
                controllingPlayer={controllerName}
                activePlayer={activeName}
                seed={this.state.board.seed}
                isBoardLoaded={this.state.board.id !== -1}
                newBoardClicked={this.newBoardClicked}
                evalButtonClicked={this.evalAnswerClicked}
                buzzerClicked={this.buzzClicked} />;
        }

        let playerScore = 0;
        if (this.state.players[this.props.joinInfo.playerId]) {
            playerScore = +this.state.players[this.props.joinInfo.playerId].score;
        }

        return <div className="game">
            <div className="game-left-panel">
                <Board
                    data={this.state.board}
                    isModerator={this.state.isModerator}
                    isControllingPlayer={this.state.controller === this.props.joinInfo.playerId}
                    activity={this.state.currentActivity}
                    playerScore={playerScore}
                    squareClickedCallback={this.boardSquareClicked}
                    dailyDoubleSubmitCallback={this.dailyDoubleWagerSubmitted} />
                {controls}
            </div>
            <div className="game-right-panel">
                <PlayersList
                    isModerator={this.state.isModerator}
                    players={this.state.players}
                    adjScoreCallback={this.adjustScore} />
            </div>
        </div>;
    }
}

