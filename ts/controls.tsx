import React from 'react';
import ReactModal from 'react-modal';
import { Activity, handleError } from './common'

enum BoardType {
    Normal = 'N',
    DoubleJeopardy = 'DJ',
    FinalJeopardy = 'FJ',
}

interface ModeratorControlsProps {
    activity: Activity,
    controllingPlayer: string | null, // name, not ID
    activePlayer: string | null, // name, not ID
    seed: string | null,
    isBoardLoaded: boolean,
    newBoardClicked: (seed: string | null, dailyDoubles: number, multiplier: number) => void,
}
interface ModeratorControlsState {
    newGameModalOpen: boolean,
    selectedBoardType: BoardType,
}
export class ModeratorControls extends React.Component<ModeratorControlsProps, ModeratorControlsState> {
    state: ModeratorControlsState = {
        newGameModalOpen: false,
        selectedBoardType: BoardType.Normal,
    };

    newBoardSeedInputs = [
        React.createRef<HTMLInputElement>(),
        React.createRef<HTMLInputElement>(),
        React.createRef<HTMLInputElement>(),
    ];

    newBoardDailyDoubleInput = React.createRef<HTMLInputElement>();

    constructor(props: ModeratorControlsProps) {
        super(props);

        this.handleOpenNewGameModal = this.handleOpenNewGameModal.bind(this);
        this.handleSubmitNewGameModal = this.handleSubmitNewGameModal.bind(this);
        this.handleCloseNewGameModal = this.handleCloseNewGameModal.bind(this);
        this.handleBoardTypeChanged = this.handleBoardTypeChanged.bind(this);
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

        let multiplier;
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

        this.props.newBoardClicked(seed, dailyDoubles, multiplier);

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
                break;
            }
            case BoardType.DoubleJeopardy: {
                boardType = BoardType.DoubleJeopardy;
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

    render() {
        let activityString;
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

            case Activity.WaitForBuzz: {
                activityString = 'Wait for a player to buzz, or skip the question.';
                break;
            }

            case Activity.EvaluateAnswer: {
                activityString = 'Wait for the active player to give an answer, then click ' +
                    'correct or incorrect.';
                break;
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
                        <form onSubmit={this.handleSubmitNewGameModal}>
                            <ul className="new-board-options">
                                <li className="board-option-label">
                                    Seed (three words, or leave blank for random):
                            </li>
                                <li>
                                    <input type="text" ref={this.newBoardSeedInputs[0]} />
                                    <input type="text" ref={this.newBoardSeedInputs[1]} />
                                    <input type="text" ref={this.newBoardSeedInputs[2]} />
                                </li>
                                <li className="board-option-label">
                                    Daily Doubles:
                            </li>
                                <li>
                                    <input
                                        type="number"
                                        min="0"
                                        max="30"
                                        defaultValue="2"
                                        ref={this.newBoardDailyDoubleInput} />
                                </li>
                                <li className="board-option-label">
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
            </div>
        </div>;
    }
}