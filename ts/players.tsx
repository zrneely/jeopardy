import React from 'react';
import ReactModal from 'react-modal';
import { ServerData } from './common';

interface PlayersListProps {
    isModerator: boolean,
    players: { [playerId: string]: ServerData.Player },
    adjScoreCallback: (playerId: string, newScore: number) => void,
}
interface PlayersListState {
    playerIdAdjusting: string | null,
}
export class PlayersList extends React.Component<PlayersListProps, PlayersListState> {
    state: PlayersListState = {
        playerIdAdjusting: null,
    }

    adjustScoreModalScoreField = React.createRef<HTMLInputElement>();

    constructor(props: PlayersListProps) {
        super(props);

        this.handleCloseAdjustScoreModal = this.handleCloseAdjustScoreModal.bind(this);
        this.handleSubmitAdjustScoreModal = this.handleSubmitAdjustScoreModal.bind(this);
    }

    activateAdjustScoreModal(playerId: string) {
        this.setState({
            playerIdAdjusting: playerId,
        });
    }

    handleCloseAdjustScoreModal() {
        this.setState({
            playerIdAdjusting: null,
        });
    }

    handleSubmitAdjustScoreModal() {
        if ((this.state.playerIdAdjusting !== null) && (this.adjustScoreModalScoreField.current !== null)) {
            this.props.adjScoreCallback(
                this.state.playerIdAdjusting,
                this.adjustScoreModalScoreField.current.valueAsNumber);
        }

        this.setState({
            playerIdAdjusting: null,
        });
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

            let score;
            if (+player.score < 0) {
                score = <span className="dollar-display dollar-display-negative">
                    ${Math.abs(+player.score)}
                </span>;
            } else {
                score = <span className="dollar-display">
                    ${player.score}
                </span>;
            }

            let entry;
            if (this.props.isModerator) {
                entry = <li
                    className="players-list-entry players-list-entry-moderator"
                    key={playerId}
                    onClick={this.activateAdjustScoreModal.bind(this, playerId)}>

                    <img className="player-avatar" src={player.avatar_url} width="150" height="150" />
                    <div className="players-list-entry-name">{player.name}</div>
                    {score}
                </li>;
            } else {
                entry = <li className="players-list-entry" key={playerId}>
                    <img className="player-avatar" src={player.avatar_url} width="150" height="150" />
                    <div className="players-list-entry-name">{player.name}</div>
                    {score}
                </li>;
            }

            players.push(entry);
        }

        let adjPlayerScore = this.state.playerIdAdjusting === null ?
            0 :
            this.props.players[this.state.playerIdAdjusting].score;

        return <div>
            <ul className="players-list">
                {players}
            </ul>

            <ReactModal
                isOpen={this.state.playerIdAdjusting !== null}
                onRequestClose={this.handleCloseAdjustScoreModal}
                shouldCloseOnEsc={true}
                shouldCloseOnOverlayClick={true}
                shouldFocusAfterRender={true}
                ariaHideApp={false}
                className="adjust-score-modal"
                contentLabel="Change Player Score...">

                <h3>View/Change Player Properties</h3>

                <input type="number" defaultValue={adjPlayerScore} ref={this.adjustScoreModalScoreField} />

                <div className="bottom-buttons">
                    <button onClick={this.handleCloseAdjustScoreModal} type="button">Cancel</button>
                    <button onClick={this.handleSubmitAdjustScoreModal} type="submit">Save</button>
                </div>

            </ReactModal>
        </div >;
    }
}