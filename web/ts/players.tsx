import React from 'react';
import ReactModal from 'react-modal';
import { handleError, ServerData, JeopardyContext } from './common';

interface PlayersListProps {
    isModerator: boolean,
    controllerId: string | null,
    activePlayerId: string | null,
    players: { [playerId: string]: ServerData.Player },
}
interface PlayersListState {
    playerIdAdjusting: string | null,
}
export class PlayersList extends React.Component<PlayersListProps, PlayersListState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

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
            this.context.withSession((session, argument) => {
                argument['target'] = this.state.playerIdAdjusting!;
                argument['new_score'] = this.adjustScoreModalScoreField.current!.valueAsNumber.toString();

                session.call('jpdy.change_player_score', [], argument).then(() => {
                    console.log('change_player_score call succeeded!');
                }, (error) => {
                    handleError('change_player_score call failed', error, false);
                });
            });
        }

        this.setState({
            playerIdAdjusting: null,
        });
    }

    getCssClassesForPlayer(playerId: string) {
        let base = ['players-list-entry'];
        if (playerId === this.props.activePlayerId) {
            base.push('players-list-entry-active');
        } else if (playerId === this.props.controllerId) {
            base.push('players-list-entry-controller');
        } else {
            base.push('players-list-entry');
        }

        if (this.props.isModerator) {
            base.push('players-list-entry-moderator');
        }

        return base.join(' ');
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

            const classes = this.getCssClassesForPlayer(playerId);

            let entry;
            if (this.props.isModerator) {
                entry = <li
                    className={classes}
                    key={playerId}
                    onClick={this.activateAdjustScoreModal.bind(this, playerId)}>

                    <img className="player-avatar" src={player.avatar_url} width="150" height="150" />
                    <div className="players-list-entry-name">{player.name}</div>
                    {score}
                </li>;
            } else {
                entry = <li className={classes} key={playerId}>
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
                        {/*todo: kick, rename, clear avatar, make controller, make active*/}
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