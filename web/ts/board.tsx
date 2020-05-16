import React, { ChangeEvent } from 'react';
import { ServerData, handleError, Activity } from './common'

interface SquareProps {
    data: ServerData.Square,
    rowIndex: number,
    boardId: number,
    value: number,
    squareClickedCallback: (row: number) => void,
}
class Square extends React.PureComponent<SquareProps> {
    constructor(props: SquareProps) {
        super(props);

        this.handleSquareClicked = this.handleSquareClicked.bind(this);
    }

    handleSquareClicked() {
        this.props.squareClickedCallback(this.props.rowIndex);
    }

    render() {
        if (this.props.data.state === ServerData.SquareState.Finished) {
            return <div className="square">&nbsp;</div>;
        } else {
            return <div className="square dollar-display" onClick={this.handleSquareClicked}>
                <small>$</small>{this.props.value}
            </div>;
        }
    }
}

interface CategoryProps {
    data: ServerData.Category,
    categoryIndex: number,
    boardId: number,
    multiplier: number,
    squareClickedCallback: (category: number, row: number) => void,
}
class Category extends React.PureComponent<CategoryProps> {
    constructor(props: CategoryProps) {
        super(props);

        this.handleSquareClicked = this.handleSquareClicked.bind(this);
    }

    handleSquareClicked(row: number) {
        this.props.squareClickedCallback(this.props.categoryIndex, row);
    }

    render() {
        let commentary;
        if (this.props.data.commentary !== undefined) {
            commentary = <div className="category-commentary">
                {this.props.data.commentary}
            </div>;
        } else {
            commentary = <div className="category-commentary-invis"></div>
        }

        return <div className="category">
            <div className="category-title">
                {this.props.data.title}
            </div>
            {commentary}
            {this.props.data.squares.map((square, idx) => {
                return <Square
                    data={square}
                    rowIndex={idx}
                    boardId={this.props.boardId}
                    value={this.props.multiplier * (idx + 1)}
                    key={(1000 * this.props.boardId) + idx}
                    squareClickedCallback={this.handleSquareClicked} />;
            })}
        </div>;
    }
}

interface FlippedSquareResult {
    square: ServerData.Square,
    categoryTitle: string,
    value: number,
}
interface BoardProps {
    data: ServerData.Board,
    isModerator: boolean,
    isControllingPlayer: boolean,
    activity: Activity,
    playerScore: number,
    squareClickedCallback: (location: ServerData.BoardLocation) => void,
    dailyDoubleSubmitCallback: (wager: number) => void,
}
interface BoardState {
    dailyDoubleWager: number,
}
export class Board extends React.PureComponent<BoardProps, BoardState> {
    constructor(props: BoardProps) {
        super(props);

        this.handleSquareClicked = this.handleSquareClicked.bind(this);
        this.handleDailyDoubleWagerChange = this.handleDailyDoubleWagerChange.bind(this);
        this.handleSubmitDailyDoubleWager = this.handleSubmitDailyDoubleWager.bind(this);
    }

    state = {
        dailyDoubleWager: 0,
    }

    handleSquareClicked(category: number, row: number) {
        this.props.squareClickedCallback({ row, category });
    }

    handleDailyDoubleWagerChange(e: ChangeEvent<HTMLInputElement>) {
        console.log('handleDailyDoubleWagerChange');
        this.setState({
            dailyDoubleWager: e.target.valueAsNumber,
        });
    }

    handleSubmitDailyDoubleWager() {
        this.props.dailyDoubleSubmitCallback(this.state.dailyDoubleWager);
        this.setState({
            dailyDoubleWager: 0,
        });
    }

    componentDidUpdate() {
        // Ensure that the wager doesn't go above the player's score
        if (this.state.dailyDoubleWager > this.getMaxWager()) {
            this.setState({
                dailyDoubleWager: this.getMaxWager(),
            });
        }
    }

    findFlippedSquare(): FlippedSquareResult | null {
        for (let category of this.props.data.categories) {
            for (let i = 0; i < category.squares.length; i++) {
                if ((category.squares[i].state === ServerData.SquareState.Flipped) ||
                    (category.squares[i].state === ServerData.SquareState.DailyDoubleRevealed)) {
                    return {
                        square: category.squares[i],
                        categoryTitle: category.title,
                        value: +this.props.data.value_multiplier * (i + 1),
                    };
                }
            }
        }
        return null;
    }

    getMaxWager(): number {
        // The maximum wager is either your score or the largest value on the board,
        // whatever is larger.
        return Math.max(this.props.playerScore, +this.props.data.value_multiplier * 5);
    }

    render() {
        let flipResult = this.findFlippedSquare();
        let cluePanel: React.ReactElement;
        if (flipResult !== null) {
            let answer;
            if (this.props.isModerator) {
                answer = <div className="clue-panel-answer">Answer: {flipResult.square.answer}</div>;
            } else {
                answer = <div className="clue-panel-answer">&nbsp;</div>;
            }

            let clueMediaEmbed = null;
            if (flipResult.square.clue?.link !== undefined) {
                switch (flipResult.square.clue?.link.split('.').pop()) {
                    case 'mp3':
                    case 'wav': {
                        clueMediaEmbed = <div className="clue-panel-clue-img">
                            <audio src={flipResult.square.clue?.link} />
                        </div>;
                        break;
                    }

                    case 'jpg':
                    case 'png': {
                        clueMediaEmbed = <div className="clue-panel-clue-img">
                            <img src={flipResult.square.clue?.link} />
                        </div>;
                        break;
                    }

                    case 'mp4':
                    case 'mov':
                    case 'wmv': {
                        clueMediaEmbed = <div className="clue-panel-clue-img">
                            <video src={flipResult.square.clue?.link} />
                        </div>;
                        break;
                    }

                    default: {
                        handleError('unknown embed extension', null, false);
                        clueMediaEmbed = <div className="clue-panel-img">
                            &nbsp;
                        </div>;
                    }
                }
            }

            let clueElementTemp = null;
            let className = 'clue-panel';
            let dailyDoubleIndicator = '';
            if ((this.props.activity === Activity.WaitForDailyDoubleWager) ||
                (this.props.activity === Activity.DailyDoubleWager)) {
                className += ' clue-panel-dd';
                dailyDoubleIndicator = ' (Daily Double)';

                if (this.props.isControllingPlayer) {
                    clueElementTemp = <div className="daily-double-input">
                        <div>
                            Enter your daily double wager:
                        </div>
                        <div className="labels">
                            <span>$0</span>
                            <span>${this.getMaxWager()}</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={this.getMaxWager()}
                            step="1"
                            value={this.state.dailyDoubleWager}
                            onChange={this.handleDailyDoubleWagerChange} />
                        <input
                            type="number"
                            min={0}
                            max={this.getMaxWager()}
                            value={this.state.dailyDoubleWager}
                            onChange={this.handleDailyDoubleWagerChange} />
                        <button onClick={this.handleSubmitDailyDoubleWager}>
                            Submit
                        </button>
                    </div>;
                }
            }

            let clueElement = clueElementTemp || <div className="clue-panel-clue-text">
                {flipResult.square.clue?.text}
            </div>;

            cluePanel = <div className={className}>
                <div className="clue-panel-category-ident">
                    {flipResult.categoryTitle} - ${flipResult.value} {dailyDoubleIndicator}
                </div>
                {clueMediaEmbed}
                {clueElement}
                {answer}
            </ div>;
        } else {
            cluePanel = <div className="clue-panel-hidden">&nbsp;</div>;
        }

        return <div className="board">
            {this.props.data.categories.map((category, idx) => {
                return <Category
                    data={category}
                    categoryIndex={idx}
                    boardId={this.props.data.id}
                    multiplier={+this.props.data.value_multiplier}
                    key={(1000 * this.props.data.id) + idx}
                    squareClickedCallback={this.handleSquareClicked} />;
            })}
            {cluePanel}
        </div>;
    }
}