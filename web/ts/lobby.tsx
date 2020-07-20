///<reference types='autobahn' />
///<reference types='react' />

import autobahn from 'autobahn';
import React from 'react';
import ReactModal from 'react-modal';

import { ServerData, handleError } from './common';
import { AvatarInput } from './avatar';

const LOBBY_CHANNEL = 'jpdy.chan.lobby';

interface LobbyState {
    openGames: ServerData.OpenGame[] | null,
    avatarUrl: string | null,
    selectedGameId: string | null,
    joinAsSpectator: boolean,
    userInfoModalOpen: boolean,
}

export interface LobbyProps {
    session: autobahn.Session,
    makeGameCallback: (name: string, avatar: string) => void,
    joinGameCallback: (name: string, avatar: string, gameId: string) => void,
    spectateGameCallback: (gameId: string, channel: string) => void,
    gotGlobalMetadataCallback: (minCategoryYear: number, maxCategoryYear: number) => void,
}

export class Lobby extends React.Component<LobbyProps, LobbyState> {
    state: LobbyState = {
        openGames: null,
        avatarUrl: null,
        selectedGameId: null,
        joinAsSpectator: false,
        userInfoModalOpen: false,
    };

    private subscription: autobahn.Subscription | null = null;
    private userNameRef = React.createRef<HTMLInputElement>();

    constructor(props: LobbyProps) {
        super(props);

        this.handleJoinOrMakeGameClick = this.handleJoinOrMakeGameClick.bind(this);
        this.handleCloseUserInfoModal = this.handleCloseUserInfoModal.bind(this);
        this.handleSubmitUserInfoModal = this.handleSubmitUserInfoModal.bind(this);
    }

    handleNewGameList(games: ServerData.OpenGame[]) {
        games.sort((a, b) => {
            // Sort by moderator name, then game ID
            const moderatorCompare = a.moderator.localeCompare(b.moderator);
            if (moderatorCompare === 0) {
                return a.game_id.localeCompare(b.game_id);
            }
            return moderatorCompare;
        });

        this.setState({
            openGames: games,
        });
    }

    componentDidMount() {
        this.props.session.call<autobahn.Result>('jpdy.list_games').then((result) => {
            console.log('initial open games call succeeded!');
            this.handleNewGameList(result.kwargs['games']);
            this.props.gotGlobalMetadataCallback(result.kwargs['min_year'], result.kwargs['max_year']);
        }, (error: any) => {
            handleError('initial open games request failed', error, false);
        });

        this.props.session.subscribe(LOBBY_CHANNEL, (_, kwargs) => {
            console.log('got new list of open games');
            this.handleNewGameList(kwargs['games']);
            this.props.gotGlobalMetadataCallback(kwargs['min_year'], kwargs['max_year']);
        }).then((subscription) => {
            this.subscription = subscription;
        }, (error: any) => {
            handleError('subscription to lobby channel failed', error, false);
        });
    }

    componentWillUnmount() {
        if (this.subscription !== null) {
            this.props.session.unsubscribe(this.subscription);
            this.subscription = null;
        }
    }

    handleCloseUserInfoModal() {
        this.setState({
            userInfoModalOpen: false,
        });
    }

    handleSubmitUserInfoModal() {
        if (this.userNameRef.current !== null) {
            if (this.userNameRef.current.value.length > 0) {
                if (this.state.selectedGameId === null) {
                    this.props.makeGameCallback(
                        this.userNameRef.current.value,
                        localStorage.getItem('avatar')!);
                } else {
                    this.props.joinGameCallback(
                        this.userNameRef.current.value,
                        localStorage.getItem('avatar')!,
                        this.state.selectedGameId);
                }

                this.setState({
                    selectedGameId: null,
                    userInfoModalOpen: false,
                });

                return;
            }
        }

        alert('Please enter a name!');
    }

    // If gameId is null, we're making a new game.
    handleJoinOrMakeGameClick(gameId: string | null, joinAsSpectator: boolean) {
        if (joinAsSpectator) {
            if (gameId !== null && this.state.openGames !== null) {
                let channel = null;
                for (let game of this.state.openGames) {
                    if (game.game_id === gameId) {
                        channel = game.channel;
                    }
                }

                if (channel !== null) {
                    this.props.spectateGameCallback(gameId, channel);
                }
            }
        } else {
            this.setState({
                joinAsSpectator,
                selectedGameId: gameId,
                userInfoModalOpen: true,
            });
        }
    }

    renderGames(games: ServerData.OpenGame[]): React.ReactElement {
        let elements = [
            <li key='makegame'>
                <div className='make-game' onClick={() => this.handleJoinOrMakeGameClick(null, false)}>
                    Create New Game
                </div>
            </li>
        ];
        for (let game of games) {
            let players = [];
            if (game.players.length === 0) {
                players.push(<li key='npy'>
                    <i>No players yet!</i>
                </li>);
            } else {
                for (let player of game.players) {
                    players.push(<li key={player}>{player}</li>);
                }
            }

            elements.push(<li key={game.game_id}>
                <div className='game-to-join'>
                    <div className='game-to-join-header'>
                        <h5>{game.moderator}'s Game</h5>
                        <span>
                            <button
                                onClick={() => this.handleJoinOrMakeGameClick(game.game_id, true)}>
                                Spectate 👀
                            </button>
                            <button
                                onClick={() => this.handleJoinOrMakeGameClick(game.game_id, false)}>
                                Join Game 🎲
                            </button>
                        </span>
                    </div>
                    <div className='game-to-join-body'>
                        <h4>Players:</h4>
                        <ul>
                            {players}
                        </ul>
                    </div>
                </div>
            </li>);
        }

        return <ul>
            {elements}
        </ul>
    }

    render() {
        let gameList;
        if (this.state.openGames === null) {
            gameList = <h4>Loading open games...</h4>;
        } else {
            gameList = this.renderGames(this.state.openGames);
        }

        return <div id='lobby-container'>
            <fieldset id='open-games'>
                <legend>Open Games</legend>
                <div id='open-games-container'>
                    {gameList}
                </div>
            </fieldset>

            <div>
                <small>Games created more than 24 hours ago are automatically deleted.</small>
                <br />
                <small>Hover over category titles for more information.</small>
            </div>

            <ReactModal
                isOpen={this.state.userInfoModalOpen}
                onRequestClose={this.handleCloseUserInfoModal}
                shouldCloseOnEsc={true}
                shouldCloseOnOverlayClick={true}
                ariaHideApp={false}
                className="user-info-modal"
                contentLabel="Name and Avatar">

                <div id='new-game-form'>
                    <h4>Who are you?</h4>
                    <input type='text' ref={this.userNameRef} />

                    <hr />

                    <h4>Draw an avatar:</h4>
                    <AvatarInput width={200} height={200} localStorageKey='avatar' />
                </div>

                <div className="bottom-buttons">
                    <button onClick={this.handleCloseUserInfoModal} type="button">Cancel</button>
                    <button onClick={this.handleSubmitUserInfoModal} type="submit">Submit</button>
                </div>
            </ReactModal>
        </div>;
    }
}