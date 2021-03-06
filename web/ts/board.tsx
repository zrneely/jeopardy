import React, { ChangeEvent } from 'react';
import { ServerData, handleError, Activity, JeopardyContext, EventNames } from './common'

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

    static parseCommentary(text: string | undefined, air_year: number): string | undefined {
        text = text || '';
        if (text.length > 0) {
            text += ' ';
        }
        return text.replace('Alex: ', '')
            .replace('(', '')
            .replace(')', '')
            + `(Air Date: ${air_year})`;
    }

    render() {
        return <div className="category">
            <div className="category-title" title={Category.parseCommentary(
                this.props.data.commentary,
                this.props.data.air_year)}>

                {this.props.data.title}{this.props.data.commentary !== undefined ? '*' : ''}
            </div>
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
    category: ServerData.Category,
    value: number,
}
interface BoardProps {
    data: ServerData.Board,
    isModerator: boolean,
    isControllingPlayer: boolean,
    activity: Activity,
    playerScore: number,
}
interface BoardState {
    dailyDoubleWager: number,
}
export class Board extends React.PureComponent<BoardProps, BoardState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

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
        if (this.props.isModerator) {
            this.context.withSession((session, argument) => {
                argument['category'] = category.toString();
                argument['row'] = row.toString();

                session.call('jpdy.select_square', [], argument).then(() => {
                    console.log('select square call succeededd!');
                }, (error) => {
                    handleError('select square call failed', error, false);
                });
            });
        }
    }

    handleDailyDoubleWagerChange(e: ChangeEvent<HTMLInputElement>) {
        this.setState({
            dailyDoubleWager: e.target.valueAsNumber,
        });
    }

    handleSubmitDailyDoubleWager() {
        this.context.withSession((session, argument) => {
            argument['wager'] = this.state.dailyDoubleWager.toString();

            session.call('jpdy.submit_wager', [], argument).then(() => {
                console.log('submit wager call succeeded!');
                this.context.fireEvent(EventNames.StartTimer);
            }, (error) => {
                handleError('submit wager call failed', error, false);
            });
        });

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
                        category,
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
                            min={5}
                            max={this.getMaxWager()}
                            step="1"
                            value={this.state.dailyDoubleWager}
                            onChange={this.handleDailyDoubleWagerChange} />
                        <input
                            type="number"
                            min={5}
                            max={this.getMaxWager()}
                            value={this.state.dailyDoubleWager}
                            onChange={this.handleDailyDoubleWagerChange} />
                        <button onClick={this.handleSubmitDailyDoubleWager}>
                            Submit
                        </button>
                    </div>;
                } else if (!this.props.isModerator) {
                    clueElementTemp = <div className="daily-double-input">
                        Another player is entering their daily double wager.
                    </div>;
                }
            }

            let clueElement = clueElementTemp || <div className="clue-panel-clue-text">
                {flipResult.square.clue?.text}
            </div>;

            cluePanel = <div className={className}>
                <div className="clue-panel-category-ident">
                    {flipResult.category.title} ({flipResult.category.air_year}) - ${flipResult.value}
                    {dailyDoubleIndicator}
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