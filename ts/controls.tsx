import React from 'react';
import { Activity } from './common'

interface ModeratorControlsProps {
    activity: Activity,
    controllingPlayer: string | null, // name, not ID
    activePlayer: string | null, // name, not ID
    seed: string | null,
    newBoardClicked: () => void,
}
export class ModeratorControls extends React.Component<ModeratorControlsProps> {
    render() {
        let activityString;
        switch (this.props.activity) {
            case Activity.Moderate: {
                activityString = 'Ask the controlling player to select a square.';
                break;
            }
            case Activity.EvaluateAnswer: {
                activityString = 'Wait for the active player to give an answer, then click' +
                    ' correct or incorrect.';
            }
        }

        return <div className="moderator-controls">
            <div className="moderator-controls-inner">
                <div className="answer-eval-buttons">
                    <button
                        disabled={this.props.activity !== Activity.EvaluateAnswer}
                        className="eval-button-correct">
                        Correct
                    </button>
                    <button
                        disabled={this.props.activity !== Activity.EvaluateAnswer}
                        className="eval-button-incorrect">
                        Inorrect
                    </button>
                </div>
                <button onClick={this.props.newBoardClicked} className="new-board-button">New Board...</button>
                <ul className="current-stats">
                    <li>{activityString}</li>
                    <li>Control: {this.props.controllingPlayer}</li>
                    <li>Active: {this.props.activePlayer}</li>
                    <li>Board Seed: <pre>{this.props.seed}</pre></li>
                </ul>
            </div>
        </div>;
    }
}