import autobahn from 'autobahn';
import React from 'react';
import { ServerData, handleError, Activity, JeopardyContext, EventNames } from './common';
import { Board } from './board';
import { ModeratorControls } from './moderatorControls';
import { PlayerControls } from './playerControls';
import { PlayersList } from './players';
import { Toolbar } from './toolbar';
import { FinalJeopardy } from './finalJeopardy';

interface GameState {
    isModerator: boolean,
    currentActivity: Activity,
    board: ServerData.Board,
    players: { [player_id: string]: ServerData.Player },
    controllerId: string | null,
    activePlayerId: string | null,
    moderatorName: string | null,
    finalJeopardyCategory: string | null,
    finalJeopardyQuestion: ServerData.Clue | null,
    finalJeopardyAnswersLocked: boolean,
    finalJeopardySelectedPlayerId: string | null,
}

export interface GameProps {
    leaveGameCallback: () => void,
    gotGlobalMetadataCallback: (minCategoryYear: number, maxCategoryYear: number) => void,
}

export class Game extends React.Component<GameProps, GameState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

    state: GameState = {
        isModerator: false,
        currentActivity: Activity.Wait,
        board: this.getEmptyBoard(),
        players: {},
        controllerId: null,
        activePlayerId: null,
        moderatorName: null,
        finalJeopardyCategory: null,
        finalJeopardyQuestion: null,
        finalJeopardyAnswersLocked: false,
        finalJeopardySelectedPlayerId: null,
    };

    private gameUpdateSubscription: autobahn.Subscription | null = null;

    constructor(props: GameProps) {
        super(props);

        this.loadNewState = this.loadNewState.bind(this);
        this.getEmptyBoard = this.getEmptyBoard.bind(this);

        this.leaveGameClicked = this.leaveGameClicked.bind(this);
        this.endGameClicked = this.endGameClicked.bind(this);
        this.selectPlayerFinalJeopardy = this.selectPlayerFinalJeopardy.bind(this);
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
                air_year: 420,
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
                case 'WaitingForEnableBuzzer': return Activity.EnableBuzzer;
                case 'WaitingForBuzzer': return Activity.WaitForBuzz;
                case 'WaitingForDailyDoubleWager': return Activity.WaitForDailyDoubleWager;
                case 'WaitingForAnswer': return Activity.EvaluateAnswer;
                case 'FinalJeopardy': return Activity.FinalJeopardy;
                default: {
                    handleError('unknown game state', '', true);
                    return Activity.Wait;
                }
            }
        } else {
            switch (gameState.type) {
                case 'NoBoard': return Activity.Wait;
                case 'WaitingForSquareSelection': return Activity.Wait;
                case 'WaitingForEnableBuzzer': return Activity.Wait;
                case 'WaitingForBuzzer': return Activity.Buzz;
                case 'WaitingForDailyDoubleWager': return Activity.DailyDoubleWager;
                case 'WaitingForAnswer': return Activity.WaitForEval;
                case 'FinalJeopardy': return Activity.FinalJeopardy;
                default: {
                    handleError('unknown game state', '', true);
                    return Activity.Wait;
                }
            }
        }
    }

    getController(gameState: ServerData.RemoteGameState): string | null {
        if (gameState.type === 'NoBoard' || gameState.type === 'FinalJeopardy') {
            return this.state.controllerId;
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
        if (gameState.type === 'NoBoard' || gameState.type === 'FinalJeopardy') {
            return this.getEmptyBoard();
        } else {
            return gameState.board;
        }
    }

    // Looks at the state update from the server and converts it to a new GameState.
    loadNewState(update: ServerData.GameStateUpdate) {
        if (update.is_ended) {
            this.props.leaveGameCallback();
        }

        if (this.context.minCategoryYear === null || this.context.maxCategoryYear === null) {
            this.props.gotGlobalMetadataCallback(update.min_year, update.max_year);
        }

        let finalJeopardyCategory = null;
        let finalJeopardyQuestion = null;
        let finalJeopardyAnswersLocked = false;
        if (update.state.type === 'FinalJeopardy') {
            if (update.state.question !== undefined) {
                finalJeopardyQuestion = update.state.question;
            }
            finalJeopardyCategory = update.state.category;
            finalJeopardyAnswersLocked = update.state.answers_locked;
        }

        this.setState({
            board: this.getBoard(update.state),
            currentActivity: this.getActivity(update.state, update.is_moderator),
            isModerator: update.is_moderator,
            players: update.players,
            controllerId: this.getController(update.state),
            activePlayerId: this.getActivePlayer(update.state),
            moderatorName: update.moderator,
            finalJeopardyCategory,
            finalJeopardyQuestion,
            finalJeopardyAnswersLocked,
        });
    }

    leaveGameClicked() {
        if (this.state.isModerator) {
            return;
        }

        this.context.withSession((session, argument) => {
            argument['target'] = this.context.joinInfo!.playerId;

            session.call('jpdy.leave', [], argument).then(() => {
                console.log('leave game call succeeded!');
                this.props.leaveGameCallback();
            }, (error) => {
                handleError('leave game call failed', error, true);
            });
        });
    }

    endGameClicked() {
        if (!this.state.isModerator) {
            return;
        }

        this.context.withSession((session, argument) => {
            session.call('jpdy.end_game', [], argument).then(() => {
                console.log('end game call succeeded!');
                this.props.leaveGameCallback();
            }, (error) => {
                handleError('end game call failed', error, true);
            });
        });
    }

    selectPlayerFinalJeopardy(playerId: string) {
        if (this.state.isModerator) {
            this.setState({
                finalJeopardySelectedPlayerId: playerId,
            });
        }
    }

    componentDidMount() {
        this.context.withSession((session, argument) => {
            let initialState = session.call<autobahn.Result>('jpdy.game_state', [], argument);

            let stateSubscription = session.subscribe(
                this.context.joinInfo!.channel,
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
        });
    }

    componentWillUnmount() {
        if (this.gameUpdateSubscription !== null && this.context.session !== null) {
            this.context.session.unsubscribe(this.gameUpdateSubscription);
            this.gameUpdateSubscription = null;
        }
    }

    // Used to start/stop timers triggered by remote actions
    componentDidUpdate(_: any, prevState: GameState) {
        // If we're a player and the moderator evaluated an answer,
        // stop the timer.
        if ((prevState.currentActivity === Activity.WaitForEval) &&
            (this.state.currentActivity !== Activity.WaitForEval)) {

            this.context.fireEvent(EventNames.StopTimer);
        }

        if ((prevState.currentActivity === Activity.EvaluateAnswer) &&
            (this.state.currentActivity === Activity.Moderate)) {

            this.context.fireEvent(EventNames.StopTimer);
        }

        // If we're a moderator and the player submitted their daily double
        // wager, start the timer.
        if ((prevState.currentActivity === Activity.WaitForDailyDoubleWager) &&
            (this.state.currentActivity === Activity.EvaluateAnswer)) {

            this.context.fireEvent(EventNames.StartTimer);
        }
    }

    render() {
        let controllerName;
        if (this.state.controllerId === null) {
            controllerName = null;
        } else {
            controllerName = this.state.players[this.state.controllerId].name;
        }

        let activeName;
        if (this.state.activePlayerId === null) {
            activeName = null;
        } else {
            activeName = this.state.players[this.state.activePlayerId].name;
        }

        let playerScore = 0;
        let playerName = '';
        if (this.state.isModerator && this.state.moderatorName !== null) {
            playerName = this.state.moderatorName;
        }
        if (this.context.joinInfo !== null && this.state.players[this.context.joinInfo.playerId]) {
            playerScore = +this.state.players[this.context.joinInfo.playerId].score;
            playerName = this.state.players[this.context.joinInfo.playerId].name;
        }

        let board;
        if (this.state.currentActivity !== Activity.FinalJeopardy) {
            board = <Board
                data={this.state.board}
                isModerator={this.state.isModerator}
                isControllingPlayer={this.state.controllerId === (
                    this.context.joinInfo !== null ? this.context.joinInfo.playerId : null)}
                activity={this.state.currentActivity}
                playerScore={playerScore} />;
        } else {
            board = <FinalJeopardy
                isModerator={this.state.isModerator}
                players={this.state.players}
                categoryName={this.state.finalJeopardyCategory || 'Unknown Category'}
                question={this.state.finalJeopardyQuestion}
                answersLocked={this.state.finalJeopardyAnswersLocked}
                selectedPlayerId={this.state.finalJeopardySelectedPlayerId}
                selectPlayer={this.selectPlayerFinalJeopardy} />;
        }

        let controls;
        if (this.state.isModerator) {
            controls = <ModeratorControls
                activity={this.state.currentActivity}
                controllingPlayer={controllerName}
                activePlayer={activeName}
                seed={this.state.board.seed}
                players={this.state.players}
                finalJeopardyAnswersLocked={this.state.finalJeopardyAnswersLocked}
                finalJeopardyQuestionRevealed={this.state.finalJeopardyQuestion !== null}
                finalJeopardySelectedPlayerId={this.state.finalJeopardySelectedPlayerId}
                isBoardLoaded={this.state.board.id !== -1} />;
        } else {
            controls = <PlayerControls
                activity={this.state.currentActivity}
                controllingPlayer={controllerName}
                activePlayer={activeName}
                seed={this.state.board.seed}
                isBoardLoaded={this.state.board.id !== -1} />;
        }

        return <div className="game">
            <div className="game-left-panel">
                {board}
                {controls}
            </div>
            <div className="game-right-panel">
                <Toolbar
                    playerName={playerName}
                    isModerator={this.state.isModerator}
                    leaveGameCallback={this.leaveGameClicked}
                    endGameCallback={this.endGameClicked} />
                <PlayersList
                    isModerator={this.state.isModerator}
                    players={this.state.players}
                    controllerId={this.state.controllerId}
                    activePlayerId={this.state.activePlayerId} />
            </div>
        </div>;
    }
}

