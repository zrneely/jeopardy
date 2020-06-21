import React from 'react';
import ReactModal from 'react-modal';
import { Activity, handleError, ServerData, JeopardyContext, EventNames } from './common'

const TIMER_STATES = [
    [false, false, false, false, false, false, false, false, false],
    [false, false, false, false, true, false, false, false, false],
    [false, false, false, true, true, true, false, false, false],
    [false, false, true, true, true, true, true, false, false],
    [false, true, true, true, true, true, true, true, false],
    [true, true, true, true, true, true, true, true, true],
];
const TIMER_DELAY = 1000;
const TIMER_STEPS = 5;
const BUZZER_THROTTLE_TIME = 500;

interface TimerProps {
    timeRemaining: number,
}
class Timer extends React.PureComponent<TimerProps> {
    render() {
        let segments = [];
        for (let i = 0; i < 9; i++) {
            if (TIMER_STATES[this.props.timeRemaining][i]) {
                segments.push(<div key={i} className="segment-active" />);
            } else {
                segments.push(<div key={i} className="segment" />)
            }
        }

        return <div className="timer">
            {segments}
        </div>;
    }
}

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

    handleSubmitNewGameModal() {
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

        let dailyDoubles = 2;
        if (this.newBoardDailyDoubleInput.current !== null) {
            dailyDoubles = this.newBoardDailyDoubleInput.current.valueAsNumber;
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
                handleError('final jeopardy is not yet implemented!', null, false);
                return;
            }
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

        this.setState({
            newGameModalOpen: false,
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
                }
                break;
            }
            case BoardType.DoubleJeopardy: {
                boardType = BoardType.DoubleJeopardy;
                if (this.newBoardDailyDoubleInput.current !== null) {
                    this.newBoardDailyDoubleInput.current.value = '2';
                }
                break;
            }
            case BoardType.FinalJeopardy: {
                boardType = BoardType.FinalJeopardy;
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

        let correctString = 'Correct';
        let correctClass = 'eval-button-correct';
        let correctEnabled = false;
        let incorrectString = 'Incorrect';
        let incorrectClass = 'eval-button-incorrect';
        let incorrectEnabled = false;
        let skipString = 'Skip';
        let skipClass = 'eval-button-skip';
        let skipEnabled = false;

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
                correctString = 'Enable Buzzer';
                incorrectString = 'Enable Buzzer';
                skipString = 'Enable Buzzer';
                correctClass = 'eval-button-enable-buzzer';
                incorrectClass = 'eval-button-enable-buzzer';
                skipClass = 'eval-button-enable-buzzer';
                correctEnabled = true;
                incorrectEnabled = true;
                skipEnabled = true;

                activityString = 'Read the question, then enable the buzzer.';
                break;
            }

            case Activity.WaitForBuzz: {
                activityString = 'Wait for a player to buzz, or skip the question.';
                skipEnabled = true;
                break;
            }

            case Activity.WaitForDailyDoubleWager: {
                activityString = 'Wait for a player to enter their daily double wager.';
                skipEnabled = true;
                break;
            }

            case Activity.EvaluateAnswer: {
                activityString = 'Wait for the active player to give an answer, then click ' +
                    'correct or incorrect.';
                correctEnabled = true;
                incorrectEnabled = true;
                skipEnabled = true;
                break;
            }
        }

        return <div className="moderator-controls">
            <Timer timeRemaining={this.state.timerTimeRemaining} />
            <div className="moderator-controls-inner">
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalCorrectClicked}
                        disabled={!correctEnabled}
                        className={correctClass}>
                        {correctString}
                    </button>
                    <div className="current-stats-group">
                        <p>{activityString}</p>
                        <p>Board Seed: <pre>{this.props.seed}</pre></p>
                    </div>
                </div>
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalIncorrectClicked}
                        disabled={!incorrectEnabled}
                        className={incorrectClass}>
                        {incorrectString}
                    </button>
                    <div className="current-stats-group">
                        <p>Control: <span className="player-name">{this.props.controllingPlayer}</span></p>
                        <p>Active: <span className="player-name">{this.props.activePlayer}</span></p>
                    </div>
                </div>
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalSkipClicked}
                        disabled={!skipEnabled}
                        className={skipClass}>
                        {skipString}
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

interface PlayerControlsState {
    timerTimeRemaining: number,
    buzzerThrottled: boolean,
}
export class PlayerControls extends React.Component<ControlsProps, PlayerControlsState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

    state: PlayerControlsState = {
        timerTimeRemaining: 0,
        buzzerThrottled: false,
    };

    startTimerId = -1;
    stopTimerId = -1;

    constructor(props: ControlsProps) {
        super(props);

        this.handleBuzzClicked = this.handleBuzzClicked.bind(this);
        this.handleTimerFired = this.handleTimerFired.bind(this);
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

    handleBuzzClicked() {
        if (this.state.buzzerThrottled) {
            return;
        }

        // If we're allowed to buzz, do so.
        if ((this.state.timerTimeRemaining === 0) && (this.props.activity === Activity.Buzz)) {
            this.startTimer();

            this.context.withSession((session, argument) => {
                session.call('jpdy.buzz', [], argument).then(() => {
                    console.log('buzz succeeded!');
                }, (error) => {
                    handleError('buzz failed', error, false);
                });
            });

        } else {
            // Otherwise, disable the buzzer for the throttle time.
            this.setState({
                buzzerThrottled: true,
            });
            setTimeout(() => {
                this.setState({
                    buzzerThrottled: false,
                });
            }, BUZZER_THROTTLE_TIME);
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
        let className = [];
        if (this.state.buzzerThrottled) {
            className.push('buzz-button-throttled');
        }
        if (this.props.activity !== Activity.Buzz) {
            className.push('buzz-button-disabled');
        } else {
            className.push('buzz-button-enabled');
        }

        return <div className="player-controls">
            <Timer timeRemaining={this.state.timerTimeRemaining} />
            <button
                onClick={this.handleBuzzClicked}
                className={className.join(' ')}>
                BUZZ
            </button>
        </div>;
    }
}