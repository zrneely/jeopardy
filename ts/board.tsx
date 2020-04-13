import React from 'react';
import { ServerData } from './common'

interface SquareProps {
    data: ServerData.Square,
    rowIndex: number,
    categoryIndex: number,
    boardId: number,
    value: number,
}
class Square extends React.PureComponent<SquareProps> {
    render() {
        return <div className="square">
            <small>$</small>{this.props.value}
        </div>;
    }
}

interface CategoryProps {
    data: ServerData.Category,
    categoryIndex: number,
    boardId: number,
    multiplier: number,
}
class Category extends React.PureComponent<CategoryProps> {
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
                    categoryIndex={this.props.categoryIndex}
                    boardId={this.props.boardId}
                    value={this.props.multiplier * (idx + 1)}
                    key={(1000 * this.props.boardId) + idx} />;
            })}
        </div>;
    }
}

interface BoardProps {
    data: ServerData.Board,
}
export class Board extends React.PureComponent<BoardProps> {
    render() {
        return <div className="board">
            {this.props.data.categories.map((category, idx) => {
                return <Category
                    data={category}
                    categoryIndex={idx}
                    boardId={this.props.data.id}
                    multiplier={+this.props.data.value_multiplier}
                    key={(1000 * this.props.data.id) + idx} />;
            })}
        </div>;
    }
}