import React from 'react';
import ReactModal from 'react-modal';
import { Activity, handleError, ServerData } from './common'

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
    evalButtonClicked: (type: ServerData.AnswerType) => void,
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

        this.handleEvalCorrectClicked = this.handleEvalCorrectClicked.bind(this);
        this.handleEvalIncorrectClicked = this.handleEvalIncorrectClicked.bind(this);
        this.handleEvalSkipClicked = this.handleEvalSkipClicked.bind(this);
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

    handleEvalCorrectClicked() {
        this.props.evalButtonClicked(ServerData.AnswerType.Correct);
    }

    handleEvalIncorrectClicked() {
        this.props.evalButtonClicked(ServerData.AnswerType.Incorrect);
    }

    handleEvalSkipClicked() {
        this.props.evalButtonClicked(ServerData.AnswerType.Skip);
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

            case Activity.WaitForDailyDoubleWager: {
                activityString = 'Wait for a player to enter their daily double wager.';
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
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalCorrectClicked}
                        disabled={this.props.activity !== Activity.EvaluateAnswer}
                        className="eval-button-correct">
                        Correct
                    </button>
                    <div className="current-stats-group">
                        <p>{activityString}</p>
                        <p>Board Seed: <pre>{this.props.seed}</pre></p>
                    </div>
                </div>
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalIncorrectClicked}
                        disabled={this.props.activity !== Activity.EvaluateAnswer}
                        className="eval-button-incorrect">
                        Inorrect
                    </button>
                    <div className="current-stats-group">
                        <p>Control: <span className="player-name">{this.props.controllingPlayer}</span></p>
                        <p>Active: <span className="player-name">{this.props.activePlayer}</span></p>
                    </div>
                </div>
                <div className="moderator-controls-column">
                    <button
                        onClick={this.handleEvalSkipClicked}
                        disabled={this.props.activity !== Activity.EvaluateAnswer &&
                            this.props.activity !== Activity.WaitForBuzz &&
                            this.props.activity !== Activity.WaitForDailyDoubleWager}
                        className="eval-button-skip">
                        Skip
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
        </div>;
    }
}