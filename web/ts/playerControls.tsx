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