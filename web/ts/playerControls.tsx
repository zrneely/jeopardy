import React from 'react';
import { Activity, handleError, JeopardyContext, EventNames } from './common'
import { TIMER_DELAY, TIMER_STEPS, Timer } from './timer';

const BUZZER_THROTTLE_TIME = 500;

interface ControlsProps {
    activity: Activity,
    controllingPlayer: string | null, // name, not ID
    activePlayer: string | null, // name, not ID
    seed: string | null,
    isBoardLoaded: boolean,
    playerScore: number,
    finalJeopardyQuestionRevealed: boolean,
    finalJeopardyAnswersLocked: boolean,
    wagerSubmittedCallback: (wager: number) => void,
    answerSubmittedCallback: (answer: string) => void,
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

    fjWagerInput = React.createRef<HTMLInputElement>();
    fjAnswerInput = React.createRef<HTMLInputElement>();

    constructor(props: ControlsProps) {
        super(props);

        this.handleBuzzClicked = this.handleBuzzClicked.bind(this);
        this.handleTimerFired = this.handleTimerFired.bind(this);
        this.handleSubmitWagerClicked = this.handleSubmitWagerClicked.bind(this);
        this.handleSubmitAnswerClicked = this.handleSubmitAnswerClicked.bind(this);
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

    handleSubmitWagerClicked() {
        if (this.fjWagerInput.current !== null) {
            const wager = this.fjWagerInput.current.valueAsNumber;

            this.context.withSession((session, argument) => {
                argument['wager'] = wager.toString();

                session.call('jpdy.submit_wager', [], argument).then(() => {
                    console.log('submit fj wager call succeeded!');
                    this.props.wagerSubmittedCallback(wager);
                }, (error) => {
                    handleError('submit final jeopardy wager call failed', error, false);
                });
            });
        }
    }

    handleSubmitAnswerClicked() {
        if (this.fjAnswerInput.current !== null) {
            const answer = this.fjAnswerInput.current.value;

            this.context.withSession((session, argument) => {
                argument['answer'] = answer;

                session.call('jpdy.submit_final_jeopardy_answer', [], argument).then(() => {
                    console.log('submit fj answer call succeeded!');
                    this.props.answerSubmittedCallback(answer);
                }, (error) => {
                    handleError('submit final jeopardy answer call failed', error, false);
                });
            });
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

    renderFinalJeopardy() {
        const answerDisabled = this.props.finalJeopardyAnswersLocked || !this.props.finalJeopardyQuestionRevealed;

        return <div className='final-jeopardy-player-controls'>
            <div className='final-jeopardy-control-row'>
                Wager:
                <input
                    type='number'
                    min={0}
                    max={this.props.playerScore}
                    defaultValue={0}
                    ref={this.fjWagerInput}
                    disabled={this.props.finalJeopardyQuestionRevealed} />
                <button
                    disabled={this.props.finalJeopardyQuestionRevealed}
                    onClick={this.handleSubmitWagerClicked}>Submit Wager</button>
            </div>
            <div className='final-jeopardy-control-row'>
                Answer:
                <input
                    type='text'
                    ref={this.fjAnswerInput}
                    disabled={answerDisabled} />
                <button
                    disabled={answerDisabled}
                    onClick={this.handleSubmitAnswerClicked}>Submit Answer</button>
            </div>
        </div>;
    }

    renderNormal() {
        let className = [];
        if (this.state.buzzerThrottled) {
            className.push('buzz-button-throttled');
        }
        if (this.props.activity !== Activity.Buzz) {
            className.push('buzz-button-disabled');
        } else {
            className.push('buzz-button-enabled');
        }

        return <div className='player-controls'>
            <Timer timeRemaining={this.state.timerTimeRemaining} />
            <button
                onClick={this.handleBuzzClicked}
                className={className.join(' ')}>
                BUZZ
            </button>
        </div>;
    }

    render() {
        if (this.props.activity === Activity.FinalJeopardy) {
            return this.renderFinalJeopardy();
        } else {
            return this.renderNormal();
        }
    }
}