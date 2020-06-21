import React from 'react';

const TIMER_STATES = [
    [false, false, false, false, false, false, false, false, false],
    [false, false, false, false, true, false, false, false, false],
    [false, false, false, true, true, true, false, false, false],
    [false, false, true, true, true, true, true, false, false],
    [false, true, true, true, true, true, true, true, false],
    [true, true, true, true, true, true, true, true, true],
];
export const TIMER_DELAY = 1000;
export const TIMER_STEPS = 5;

interface TimerProps {
    timeRemaining: number,
}
export class Timer extends React.PureComponent<TimerProps> {
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