import React from 'react';
import ReactModal from 'react-modal';
import { Activity } from './common'

interface ModeratorControlsProps {
    activity: Activity,
    controllingPlayer: string | null, // name, not ID
    activePlayer: string | null, // name, not ID
    seed: string | null,
    newBoardClicked: () => void,
}
interface ModeratorControlsState {
    newGameModalOpen: boolean,
}
export class ModeratorControls extends React.Component<ModeratorControlsProps, ModeratorControlsState> {
    state: ModeratorControlsState = {
        newGameModalOpen: false,
    };

    newBoardSeedInputs = [
        React.createRef<HTMLInputElement>(),
        React.createRef<HTMLInputElement>(),
        React.createRef<HTMLInputElement>(),
    ];

    constructor(props: ModeratorControlsProps) {
        super(props);

        this.handleOpenNewGameModal = this.handleOpenNewGameModal.bind(this);
        this.handleSubmitNewGameModal = this.handleSubmitNewGameModal.bind(this);
        this.handleCloseNewGameModal = this.handleCloseNewGameModal.bind(this);
    }

    handleOpenNewGameModal() {
        this.setState({
            newGameModalOpen: true,
        });
    }

    handleSubmitNewGameModal() {
        this.props.newBoardClicked();

        this.setState({
            newGameModalOpen: false,
        });
    }

    handleCloseNewGameModal() {
        this.setState({
            newGameModalOpen: false,
        });
    }

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
                <button onClick={this.handleOpenNewGameModal} className="new-board-button">
                    New Board...
                </button>
                <ul className="current-stats">
                    <li>{activityString}</li>
                    <li>Control: {this.props.controllingPlayer}</li>
                    <li>Active: {this.props.activePlayer}</li>
                    <li>Board Seed: <pre>{this.props.seed}</pre></li>
                </ul>

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
                        <ul className="new-board-options">
                            <li>
                                Seed (three words, or leave blank for random):
                            </li>
                            <li>
                                <input type="text" ref={this.newBoardSeedInputs[0]} />
                                <input type="text" ref={this.newBoardSeedInputs[1]} />
                                <input type="text" ref={this.newBoardSeedInputs[2]} />
                            </li>
                            <li>
                                Daily Doubles:
                            </li>
                            <li>
                                <input type="number" min="0" max="30" />
                            </li>
                            <li>
                                Board Type:
                            </li>
                            <li>
                                <input type="radio" value="Normal" />
                                <input type="radio" value="Double Jeopardy" />
                                <input type="radio" value="Final Jeopardy" />
                            </li>
                        </ul>
                    </fieldset>

                    <div className="bottom-buttons">
                        <button onClick={this.handleCloseNewGameModal}>Cancel</button>
                        <button onClick={this.handleSubmitNewGameModal}>Submit</button>
                    </div>

                </ReactModal>
            </div>
        </div>;
    }
}