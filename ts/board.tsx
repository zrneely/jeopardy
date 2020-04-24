import React from 'react';
import { CSSTransition } from 'react-transition-group';
import { ServerData } from './common'

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
            return <div className="square" onClick={this.handleSquareClicked}>
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

    findFlippedSquare(): ServerData.Square | null {
        for (let category of this.props.data.categories) {
            for (let square of category.squares) {
                if (square.state === ServerData.SquareState.Flipped) {
                    return square;
                }
            }
        }
        return null;
    }

    render() {
        let activeSquare = this.findFlippedSquare();
        let cluePanelContent: React.ReactElement;
        if (activeSquare !== null) {
            let answer = null;
            if (this.props.isModerator) {
                answer = <span>{JSON.stringify(activeSquare.answer)}</span>;
            }

            cluePanelContent = <div className="clue-panel">
                {JSON.stringify(activeSquare.clue)}
                {answer}
            </ div>;
        } else {
            cluePanelContent = <div className="clue-panel"></div>;
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
            <CSSTransition
                in={activeSquare !== null}
                timeout={500} // milliseconds
                classNames="clue-panel">

                {cluePanelContent}
            </CSSTransition>
        </div>;
    }
}