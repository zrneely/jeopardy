import React from 'react';
import { ServerData, JeopardyContext } from './common';

interface PlayerDisplayProps {
    players: { [playerId: string]: ServerData.Player },
    selectedPlayerId: string | null,
    playerSelected: (playerId: string) => void,
}

class PlayerDisplay extends React.PureComponent<PlayerDisplayProps, {}> {
    constructor(props: PlayerDisplayProps) {
        super(props);

        this.playerClicked = this.playerClicked.bind(this);
    }

    playerClicked(event: React.MouseEvent<HTMLElement>) {
        let node = event.currentTarget.closest('li');
        if (node !== null && node.dataset.playerid !== undefined) {
            this.props.playerSelected(node.dataset.playerid);
        }
    }

    render() {
        let keys = Object.keys(this.props.players);
        let orderedPlayerIds = [];
        for (let key of keys) {
            if (this.props.players.hasOwnProperty(key)) {
                orderedPlayerIds.push(key);
            }
        }
        orderedPlayerIds.sort((id1, id2) => {
            return this.props.players[id1].name.localeCompare(this.props.players[id2].name);
        });

        let players: React.ReactElement[] = [];
        for (let playerId of orderedPlayerIds) {
            const player = this.props.players[playerId];

            let answer;
            if (player.final_jeopardy_info.answer === undefined) {
                answer = 'Answer: ???';
            } else if (player.final_jeopardy_info.answer === null) {
                answer = 'No answer submitted';
            } else {
                answer = `Answer: ${player.final_jeopardy_info.answer}`;
            }
            let answerClass;
            switch (player.final_jeopardy_info.answer_revealed) {
                case undefined: {
                    answerClass = 'final-jeopardy-info';
                    break;
                }
                case true: {
                    answerClass = 'final-jeopardy-info final-jeopardy-info-revealed';
                    break;
                }
                case false: {
                    answerClass = 'final-jeopardy-info final-jeopardy-info-hidden';
                    break;
                }
            }
            let answerEle = <span className={answerClass}>{answer}</span>;

            let wager;
            if (player.final_jeopardy_info.wager === undefined) {
                wager = 'Wager: ???';
            } else if (player.final_jeopardy_info.wager === null) {
                wager = 'No wager submitted';
            } else {
                wager = `Wager: ${player.final_jeopardy_info.wager}`;
            }
            let wagerClass;
            switch (player.final_jeopardy_info.wager_revealed) {
                case undefined: {
                    wagerClass = 'final-jeopardy-info';
                    break;
                }
                case true: {
                    wagerClass = 'final-jeopardy-info final-jeopardy-info-revealed';
                    break;
                }
                case false: {
                    wagerClass = 'final-jeopardy-info final-jeopardy-info-hidden';
                    break;
                }
            }
            let wagerEle = <span className={wagerClass}>{wager}</span>;

            let className = '';
            if (this.props.selectedPlayerId === playerId) {
                className = 'selected';
            }

            players.push(<li
                key={playerId}
                className={className}
                onClick={this.playerClicked}
                data-playerid={playerId}>

                <span className='player-name-fj'>{player.name}</span>
                <img src={player.avatar_url} className='player-avatar-small' />
                {answerEle}
                {wagerEle}
            </li>);
        }

        return <ul className='final-jeopardy-player-display'>
            {players}
        </ul>;
    }
}

interface FinalJeopardyProps {
    players: { [playerId: string]: ServerData.Player },
    isModerator: boolean,
    categoryName: string,
    question: ServerData.Clue | null,
    answersLocked: boolean,
    selectedPlayerId: string | null,
    selectPlayer: (playerId: string) => void,
}

interface FinalJeopardyState { }

export class FinalJeopardy extends React.PureComponent<FinalJeopardyProps, FinalJeopardyState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

    state = {};

    wagerInput = React.createRef<HTMLInputElement>();
    answerInput = React.createRef<HTMLInputElement>();

    constructor(props: FinalJeopardyProps) {
        super(props);

        this.playerSelected = this.playerSelected.bind(this);
    }

    playerSelected(playerId: string) {
        this.props.selectPlayer(playerId);
    }

    render() {
        return <div className='final-jeopardy'>
            <div className='final-jeopardy-category'>
                {this.props.categoryName}
            </div>
            <div className='final-jeopardy-question'>
                {this.props.question?.text}
            </div>
            <PlayerDisplay
                players={this.props.players}
                selectedPlayerId={this.props.selectedPlayerId}
                playerSelected={this.playerSelected} />
        </div>;
    }
}