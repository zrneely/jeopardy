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
        return <div className="moderator-controls">
            <button disabled={this.props.activity !== Activity.EvaluateAnswer}>Correct Answer</button>
            <button disabled={this.props.activity !== Activity.EvaluateAnswer}>Inorrect Answer</button>
            <ul>
                <li>Player in control: {this.props.controllingPlayer}</li>
                <li>Player currently answering: {this.props.activePlayer}</li>
                <li>Board seed: {this.props.seed}</li>
            </ul>
            <button onClick={this.props.newBoardClicked}>New Board</button>
        </div>;
    }
}