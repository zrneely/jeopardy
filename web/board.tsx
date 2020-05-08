import React from 'react';
import { ServerData, handleError } from './common'

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

interface BoardProps {
    data: ServerData.Board,
    isModerator: boolean,
    squareClickedCallback: (location: ServerData.BoardLocation) => void,
}
export class Board extends React.PureComponent<BoardProps> {
    constructor(props: BoardProps) {
        super(props);

        this.handleSquareClicked = this.handleSquareClicked.bind(this);
    }

    handleSquareClicked(category: number, row: number) {
        this.props.squareClickedCallback({ row, category });
    }

    findFlippedSquare(): [ServerData.Square, string, number] | null {
        for (let category of this.props.data.categories) {
            for (let i = 0; i < category.squares.length; i++) {
                if (category.squares[i].state === ServerData.SquareState.Flipped) {
                    return [
                        category.squares[i],
                        category.title,
                        +this.props.data.value_multiplier * (i + 1)
                    ];
                }
            }
        }
        return null;
    }

    render() {
        let flipResult = this.findFlippedSquare();
        let cluePanel: React.ReactElement;
        if (flipResult !== null) {
            let [activeSquare, categoryTitle, value] = flipResult;

            let answer;
            if (this.props.isModerator) {
                answer = <div className="clue-panel-answer">Answer: {activeSquare.answer}</div>;
            } else {
                answer = <div className="clue-panel-answer">&nbsp;</div>;
            }

            let clueMediaEmbed = null;
            if (activeSquare.clue?.link !== undefined) {
                switch (activeSquare.clue?.link.split('.').pop()) {
                    case 'mp3':
                    case 'wav': {
                        clueMediaEmbed = <div className="clue-panel-clue-img">
                            <audio src={activeSquare.clue?.link} />
                        </div>;
                        break;
                    }

                    case 'jpg':
                    case 'png': {
                        clueMediaEmbed = <div className="clue-panel-clue-img">
                            <img src={activeSquare.clue?.link} />
                        </div>;
                        break;
                    }

                    case 'mp4':
                    case 'mov':
                    case 'wmv': {
                        clueMediaEmbed = <div className="clue-panel-clue-img">
                            <video src={activeSquare.clue?.link} />
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

            cluePanel = <div className="clue-panel">
                <div className="clue-panel-category-ident">
                    {categoryTitle} - ${value}
                </div>
                {clueMediaEmbed}
                <div className="clue-panel-clue-text">
                    {activeSquare.clue?.text}
                </div>
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