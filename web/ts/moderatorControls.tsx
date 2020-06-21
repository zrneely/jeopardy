import React from 'react';
import ReactModal from 'react-modal';
import { Activity, handleError, ServerData, JeopardyContext, EventNames } from './common'
import { TIMER_DELAY, TIMER_STEPS, Timer } from './timer';

enum BoardType {
    Normal = 'N',
    DoubleJeopardy = 'DJ',
    FinalJeopardy = 'FJ',
}

interface ControlsProps {
    activity: Activity,
    controllingPlayer: string | null, // name, not ID
    activePlayer: string | null, // name, not ID
    seed: string | null,
    isBoardLoaded: boolean,
    players: { [playerId: string]: ServerData.Player },
    finalJeopardyQuestionRevealed: boolean,
    finalJeopardyAnswersLocked: boolean,
    finalJeopardySelectedPlayerId: string | null,
}
interface ModeratorControlsState {
    newGameModalOpen: boolean,
    selectedBoardType: BoardType,
    timerTimeRemaining: number,
}
export class ModeratorControls extends React.Component<ControlsProps, ModeratorControlsState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

    state: ModeratorControlsState = {
        newGameModalOpen: false,
        selectedBoardType: BoardType.Normal,
        timerTimeRemaining: 0,
    };

    newBoardSeedInputs = [
        React.createRef<HTMLInputElement>(),
        React.createRef<HTMLInputElement>(),
        React.createRef<HTMLInputElement>(),
    ];

    startTimerId = -1;
    stopTimerId = -1;

    newBoardDailyDoubleInput = React.createRef<HTMLInputElement>();

    constructor(props: ControlsProps) {
        super(props);

        this.handleTimerFired = this.handleTimerFired.bind(this);
        this.handleOpenNewGameModal = this.handleOpenNewGameModal.bind(this);
        this.handleSubmitNewGameModal = this.handleSubmitNewGameModal.bind(this);
        this.handleCloseNewGameModal = this.handleCloseNewGameModal.bind(this);
        this.handleBoardTypeChanged = this.handleBoardTypeChanged.bind(this);

        this.handleEvalCorrectClicked = this.handleEvalCorrectClicked.bind(this);
        this.handleEvalIncorrectClicked = this.handleEvalIncorrectClicked.bind(this);
        this.handleEvalSkipClicked = this.handleEvalSkipClicked.bind(this);
    }

    componentDidMount() {
        this.startTimerId = this.context.listenEvent(EventNames.StartTimer, () => {
            this.startTimer();
        });
        this.stopTimerId = this.context.listenEvent(EventNames.StopTimer, () => {
            this.stopTimer();
        });
    }

    componentWillUnmount() {
        this.context.unlistenEvent(EventNames.StartTimer, this.startTimerId);
        this.context.unlistenEvent(EventNames.StopTimer, this.stopTimerId);
    }

    componentDidUpdate(prevProps: ControlsProps) {
        if ((this.props.activity === Activity.EvaluateAnswer) &&
            (prevProps.activity !== Activity.EvaluateAnswer)) {
            this.startTimer();
        }
    }

    handleTimerFired() {
        if (this.state.timerTimeRemaining > 1) {
            this.setState({
                timerTimeRemaining: this.state.timerTimeRemaining - 1,
            });
            setTimeout(this.handleTimerFired, TIMER_DELAY);
        } else {
            this.setState({
                timerTimeRemaining: 0,
            });
        }
    }

    handleOpenNewGameModal() {
        this.setState({
            newGameModalOpen: true,
        });
    }

    startFinalJeopardy(seed: string | null) {
        this.context.withSession((session, argument) => {
            if (seed !== null) {
                argument['seed'] = seed;
            }

            session.call('jpdy.final_jeopardy.start', [], argument).then(() => {
                console.log('start final jeopardy call succeeded');
            }, (error) => {
                handleError('start final jeopardy call failed', error, false);
            });
        });
    }

    handleSubmitNewGameModal() {
        this.setState({
            newGameModalOpen: false,
        });

        let seed: string | null = '';
        for (let seedInput of this.newBoardSeedInputs) {
            if (seedInput.current !== null) {
                seed += ` ${seedInput.current.value.trim()}`;
            }
        }
        seed = seed.trim();
        if (seed.length === 0) {
            seed = null;
        }

        let multiplier: number;
        switch (this.state.selectedBoardType) {
            case BoardType.Normal: {
                multiplier = 200;
                break;
            }
            case BoardType.DoubleJeopardy: {
                multiplier = 400;
                break;
            }
            case BoardType.FinalJeopardy: {
                this.startFinalJeopardy(seed);
                return;
            }
        }

        let dailyDoubles = 2;
        if (this.newBoardDailyDoubleInput.current !== null) {
            dailyDoubles = this.newBoardDailyDoubleInput.current.valueAsNumber;
        }

        this.context.withSession((session, argument) => {
            argument['multiplier'] = `${multiplier}`;
            argument['daily_doubles'] = `${dailyDoubles}`;
            argument['categories'] = '6';
            if (seed !== null) {
                argument['seed'] = seed;
            }

            session.call('jpdy.new_board', [], argument).then(() => {
                console.log('new board call succeeded!');
            }, (error) => {
                handleError('new board call failed', error, false);
            });
        });
    }

    handleCloseNewGameModal() {
        this.setState({
            newGameModalOpen: false,
        });
    }

    handleBoardTypeChanged(e: React.ChangeEvent<HTMLInputElement>) {
        let boardType;
        switch (e.target.value) {
            case BoardType.Normal: {
                boardType = BoardType.Normal;
                if (this.newBoardDailyDoubleInput.current !== null) {
                    this.newBoardDailyDoubleInput.current.value = '1';
                    this.newBoardDailyDoubleInput.current.disabled = false;
                }
                break;
            }
            case BoardType.DoubleJeopardy: {
                boardType = BoardType.DoubleJeopardy;
                if (this.newBoardDailyDoubleInput.current !== null) {
                    this.newBoardDailyDoubleInput.current.value = '2';
                    this.newBoardDailyDoubleInput.current.disabled = false;
                }
                break;
            }
            case BoardType.FinalJeopardy: {
                boardType = BoardType.FinalJeopardy;
                if (this.newBoardDailyDoubleInput.current !== null) {
                    this.newBoardDailyDoubleInput.current.disabled = true;
                }
                break;
            }
            default: {
                handleError('unknown board type', e.target.value, false);
                return;
            }
        }
        this.setState({
            selectedBoardType: boardType,
        });
    }

    enableBuzzerClicked() {
        this.context.withSession((session, argument) => {
            session.call('jpdy.enable_buzzer', [], argument).then(() => {
                console.log('enable buzzer call succeeded!');
            }, (error) => {
                handleError('enable buzzer call failed', error, false);
            });
        });
    }

    evalButtonClicked(answer: ServerData.AnswerType) {
        this.context.withSession((session, argument) => {
            argument['answer'] = answer;

            session.call('jpdy.answer', [], argument).then(() => {
                console.log('answer call succeeded!');
                this.stopTimer();
            }, (error) => {
                handleError('answer call failed', error, false);
            });
        });
    }

    handleEvalCorrectClicked() {
        if (this.props.activity === Activity.EnableBuzzer) {
            this.enableBuzzerClicked();
        } else {
            this.evalButtonClicked(ServerData.AnswerType.Correct);
        }
    }

    handleEvalIncorrectClicked() {
        if (this.props.activity === Activity.EnableBuzzer) {
            this.enableBuzzerClicked();
        } else {
            this.evalButtonClicked(ServerData.AnswerType.Incorrect);
        }
    }

    handleEvalSkipClicked() {
        if (this.props.activity === Activity.EnableBuzzer) {
            this.enableBuzzerClicked();
        } else {
            this.evalButtonClicked(ServerData.AnswerType.Skip);
        }
    }

    startTimer() {
        this.setState({
            timerTimeRemaining: TIMER_STEPS,
        });
        setTimeout(this.handleTimerFired, TIMER_DELAY);
    }

    stopTimer() {
        this.setState({
            timerTimeRemaining: 0,
        });
    }

    render() {
        let activityString;

        let buttons = [{
            string: 'Correct',
            className: 'eval-button-correct',
            enabled: false,
        }, {
            string: 'Incorrect',
            className: 'eval-button-incorrect',
            enabled: false,
        }, {
            string: 'Skip',
            className: 'eval-button-skip',
            enabled: false,
        }];

        switch (this.props.activity) {
            case Activity.Moderate: {
                if (this.props.controllingPlayer === null) {
                    activityString = 'Wait for a player to join the game.';
                } else if (!this.props.isBoardLoaded) {
                    activityString = 'Press the new board button.';
                } else {
                    activityString = 'Ask the controlling player to select a square.';
                }

                break;
            }

            case Activity.EnableBuzzer: {
                for (let button of buttons) {
                    button.className = 'eval-button-enable-buzzer';
                    button.string = 'Enable Buzzer';
                    button.enabled = true;
                }

                activityString = 'Read the question, then enable the buzzer.';
                break;
            }

            case Activity.WaitForBuzz: {
                activityString = 'Wait for a player to buzz, or skip the question.';
                buttons[2].enabled = true;
                break;
            }

            case Activity.WaitForDailyDoubleWager: {
                activityString = 'Wait for a player to enter their daily double wager.';
                buttons[2].enabled = true;
                break;
            }

            case Activity.EvaluateAnswer: {
                activityString = 'Wait for the active player to give an answer, then click ' +
                    'correct or incorrect.';
                for (let button of buttons) {
                    button.enabled = true;
                }
                break;
            }

            case Activity.FinalJeopardy: {
                if (this.props.finalJeopardyQuestionRevealed) {
                    if (this.props.finalJeopardyAnswersLocked) {
                        activityString = 'Evaluate the players\' answers.';

                        if (this.props.finalJeopardySelectedPlayerId !== null) {
                            const player = this.props.players[this.props.finalJeopardySelectedPlayerId];

                            if (player.final_jeopardy_info.answer_revealed) {
                                for (let button of buttons) {
                                    button.enabled = true;
                                }
                            } else {
                                buttons[0].string = 'Reveal Wager';
                                buttons[1].string = 'Reveal Answer';
                                buttons[2].string = '-';
                                buttons[2].enabled = false;

                                if (player.final_jeopardy_info.wager_revealed) {
                                    buttons[0].enabled = false;
                                    buttons[1].enabled = true;
                                } else {
                                    buttons[0].enabled = true;
                                    buttons[1].enabled = false;
                                }
                            }
                        } else {
                            for (let button of buttons) {
                                button.enabled = false;
                                button.className = 'eval-button-skip';
                                button.string = 'Select a player';
                            }
                        }
                    } else {
                        // Answers not yet locked; waiting for players to enter answers.
                        activityString = 'Wait for all players to enter their answers.';
                        for (let button of buttons) {
                            button.string = 'Lock Answers';
                            button.enabled = true;
                            button.className = 'eval-button-lock-answers';
                        }
                    }
                } else {
                    // Question is not revealed; wating for players to enter their wagers.
                    activityString = 'Wait for all players to enter their wagers.';
                    for (let button of buttons) {
                        button.string = 'Reveal Question';
                        button.enabled = true;
                        button.className = 'eval-button-reveal-question';
                    }
                }
                break;
            }
        }

        return <div className="moderator-controls">
            <Timer timeRemaining={this.state.timerTimeRemaining} />
            <div className="moderator-controls-inner">
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalCorrectClicked}
                        disabled={!buttons[0].enabled}
                        className={buttons[0].className}>
                        {buttons[0].string}
                    </button>
                    <div className="current-stats-group">
                        <p>{activityString}</p>
                        <p>Board Seed: <pre>{this.props.seed}</pre></p>
                    </div>
                </div>
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalIncorrectClicked}
                        disabled={!buttons[1].enabled}
                        className={buttons[1].className}>
                        {buttons[1].string}
                    </button>
                    <div className="current-stats-group">
                        <p>Control: <span className="player-name">{this.props.controllingPlayer}</span></p>
                        <p>Active: <span className="player-name">{this.props.activePlayer}</span></p>
                    </div>
                </div>
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalSkipClicked}
                        disabled={!buttons[2].enabled}
                        className={buttons[2].className}>
                        {buttons[2].string}
                    </button>
                    <div className="current-stats-group">
                        <button onClick={this.handleOpenNewGameModal} className="new-board-button">
                            New Board...
                        </button>
                    </div>
                </div>
            </div>

            <ReactModal
                isOpen={this.state.newGameModalOpen}
                onRequestClose={this.handleCloseNewGameModal}
                shouldCloseOnEsc={true}
                shouldCloseOnOverlayClick={true}
                shouldFocusAfterRender={true}
                ariaHideApp={false}
                className="new-board-modal"
                contentLabel="New Board...">

                <h3>Are you sure you want to load a new board?</h3>

                <fieldset className="new-board-options">
                    <legend>Options</legend>
                    <form onSubmit={this.handleSubmitNewGameModal}>
                        <ul className="new-board-options">
                            <li className="option-label">
                                Seed (three words, or leave blank for random):
                            </li>
                            <li>
                                <input type="text" ref={this.newBoardSeedInputs[0]} />
                                <input type="text" ref={this.newBoardSeedInputs[1]} />
                                <input type="text" ref={this.newBoardSeedInputs[2]} />
                            </li>
                            <li className="option-label">
                                Daily Doubles:
                            </li>
                            <li>
                                <input
                                    type="number"
                                    min="0"
                                    max="30"
                                    defaultValue={this.state.selectedBoardType == BoardType.Normal ? 1 : 2}
                                    ref={this.newBoardDailyDoubleInput} />
                            </li>
                            <li className="option-label">
                                Board Type:
                            </li>
                            <li>
                                <input
                                    type="radio"
                                    name="board-type"
                                    id="board-type-normal"
                                    value={BoardType.Normal}
                                    onChange={this.handleBoardTypeChanged}
                                    checked={this.state.selectedBoardType == BoardType.Normal} />
                                <label htmlFor="board-type-normal">Single Jeopardy</label>
                                <br />
                                <input
                                    type="radio"
                                    name="board-type"
                                    id="board-type-double-jeopardy"
                                    value={BoardType.DoubleJeopardy}
                                    onChange={this.handleBoardTypeChanged}
                                    checked={this.state.selectedBoardType == BoardType.DoubleJeopardy} />
                                <label htmlFor="board-type-double-jeopardy">Double Jeopardy</label>
                                <br />
                                <input
                                    type="radio"
                                    name="board-type"
                                    id="board-type-final-jeopardy"
                                    value={BoardType.FinalJeopardy}
                                    onChange={this.handleBoardTypeChanged}
                                    checked={this.state.selectedBoardType == BoardType.FinalJeopardy} />
                                <label htmlFor="board-type-final-jeopardy">Final Jeopardy</label>
                            </li>
                        </ul>
                    </form>
                </fieldset>

                <div className="bottom-buttons">
                    <button onClick={this.handleCloseNewGameModal} type="button">Cancel</button>
                    <button onClick={this.handleSubmitNewGameModal} type="submit">Submit</button>
                </div>

            </ReactModal>
        </div>;
    }
}