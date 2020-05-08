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

        this.handleOpenAdjustScoreModal = this.handleOpenAdjustScoreModal.bind(this);
        this.handleCloseAdjustScoreModal = this.handleCloseAdjustScoreModal.bind(this);
        this.handleSubmitAdjustScoreModal = this.handleSubmitAdjustScoreModal.bind(this);
    }

    handleOpenAdjustScoreModal() {
        if (this.adjustScoreModalScoreField.current !== null) {
            this.adjustScoreModalScoreField.current.focus();
        }
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

        let adjPlayerId = this.state.playerIdAdjusting || '';

        let adjPlayerName = this.state.playerIdAdjusting === null ?
            '' :
            this.props.players[this.state.playerIdAdjusting].name;

        let adjPlayerScore = this.state.playerIdAdjusting === null ?
            0 :
            this.props.players[this.state.playerIdAdjusting].score;

        return <div>
            <ul className="players-list">
                {players}
            </ul>

            <ReactModal
                isOpen={this.state.playerIdAdjusting !== null}
                onAfterOpen={this.handleOpenAdjustScoreModal}
                onRequestClose={this.handleCloseAdjustScoreModal}
                shouldCloseOnEsc={true}
                shouldCloseOnOverlayClick={true}
                shouldFocusAfterRender={true}
                ariaHideApp={false}
                className="adjust-score-modal"
                contentLabel="Change Player Score...">

                <fieldset className="adjust-player-options">
                    <legend>Player Options</legend>
                    <ul className="adjust-player-options">
                        <li className="option-label">
                            Player Name: {adjPlayerName}
                        </li>
                        <li className="option-label">
                            Player ID: {adjPlayerId}
                        </li>
                        <li className="option-label">
                            Player Score:
                    </li>
                        <li>
                            <input
                                type="number"
                                defaultValue={adjPlayerScore}
                                ref={this.adjustScoreModalScoreField} />
                        </li>
                    </ul>
                </fieldset>

                <div className="bottom-buttons">
                    <button onClick={this.handleCloseAdjustScoreModal} type="button">Cancel</button>
                    <button onClick={this.handleSubmitAdjustScoreModal} type="submit">Save</button>
                </div>

            </ReactModal>
        </div >;
    }
}