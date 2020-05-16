///<reference types="autobahn" />
///<reference types="react" />

import autobahn from 'autobahn';
import React from 'react';

import { ServerData, handleError } from './common';
import { AvatarInput } from './avatar';

const LOBBY_CHANNEL = "jpdy.chan.lobby";

interface LobbyState {
    openGames: ServerData.OpenGame[] | null,
    selectedGame: string | null,
    avatarUrl: string | null,
}

export interface LobbyProps {
    session: autobahn.Session,
    makeGameCallback: (name: string, avatar: string) => void,
    joinGameCallback: (name: string, avatar: string, gameId: string) => void,
}

export class Lobby extends React.Component<LobbyProps, LobbyState> {
    state: LobbyState = {
        openGames: null,
        selectedGame: null,
        avatarUrl: null,
    };

    private subscription: autobahn.Subscription | null = null;
    private userNameRef = React.createRef<HTMLInputElement>();

    constructor(props: LobbyProps) {
        super(props);

        this.handleJoinGameClick = this.handleJoinGameClick.bind(this);
        this.handleMakeGameClick = this.handleMakeGameClick.bind(this);
        this.handleChangeSelectedGame = this.handleChangeSelectedGame.bind(this);
    }

    componentDidMount() {
        this.props.session.call<autobahn.Result>('jpdy.list_games').then((result) => {
            console.log('initial open games call succeeded!');
            this.setState({
                openGames: result.kwargs['games'],
            });
        }, (error: any) => {
            handleError('initial open games request failed', error, false);
        });

        this.props.session.subscribe(LOBBY_CHANNEL, (_, kwargs) => {
            console.log('got new list of open games');
            this.setState({
                openGames: kwargs['games'],
            });
        }).then((subscription) => {
            this.subscription = subscription;
        }, (error: any) => {
            handleError('subscription to lobby channel failed', error, false);
        });
    }

    componentWillUnmount() {
        console.log('componentWillUnmount: Lobby');
        if (this.subscription !== null) {
            this.props.session.unsubscribe(this.subscription);
            this.subscription = null;
        }
    }

    handleMakeGameClick() {
        if (this.userNameRef.current !== null) {
            if (this.userNameRef.current.value.length !== 0) {
                this.props.makeGameCallback(
                    this.userNameRef.current.value,
                    localStorage.getItem('avatar')!);
            }
        }
    }

    handleJoinGameClick() {
        if ((this.userNameRef.current !== null) && (this.state.selectedGame !== null)) {
            if (this.userNameRef.current.value.length !== 0) {
                this.props.joinGameCallback(
                    this.userNameRef.current.value,
                    localStorage.getItem('avatar')!,
                    this.state.selectedGame);
            }
        }
    }

    handleChangeSelectedGame(e: React.ChangeEvent<HTMLInputElement>) {
        this.setState({
            selectedGame: e.target.value,
        });
    }

    render() {
        function listOrDefault<T, U>(a: Array<T>, orElse: () => U): Array<T> | U {
            if (a.length === 0) {
                return orElse();
            } else {
                return a;
            }
        }

        let gameList;
        if (this.state.openGames === null) {
            gameList = <h4>Loading open games...</h4>;
        } else {
            gameList = <ul>
                {this.state.openGames.map((openGame) => {
                    const id = `game-to-join-${openGame.game_id}`;
                    return (
                        <li key={openGame.game_id}>
                            <input
                                type="radio"
                                name="game-to-join"
                                id={id}
                                value={openGame.game_id}
                                onChange={this.handleChangeSelectedGame} />
                            <label htmlFor={id}>
                                {openGame.moderator}'s Game - Players:
                                <ul>
                                    {listOrDefault(openGame.players.map((player, i) => {
                                        return <li key={i}>{player}</li>;
                                    }), () => {
                                        return <li><i>No players yet!</i></li>;
                                    })}
                                </ul>
                            </label>
                        </li>
                    );
                })}
            </ul>;
        }

        let avatar: React.ReactElement | null = null;
        if (this.state.avatarUrl !== null) {
            avatar = <img src={this.state.avatarUrl} width="144" height="144" />;
        }

        return <div id="lobby-container">
            <fieldset id="open-games">
                <legend>Open Games</legend>
                <form id="open-games-container">
                    {gameList}
                </form>
            </fieldset>
            <div id="new-game-form">
                <h3>Type your name in the box!</h3>
                {avatar}
                <input type="text" name="name" ref={this.userNameRef} />
                <input type="button" id="make-game" value="Make Game" onClick={this.handleMakeGameClick} />
                <input type="button" id="join-game" value="Join Selected Game" onClick={this.handleJoinGameClick} />
                <hr />
                <h3>Draw yourself an avatar!</h3>
                <AvatarInput width={200} height={200} localStorageKey="avatar" />
                <hr />
                <small>Games created more than 24 hours ago are automatically deleted.</small>
            </div>
        </div>;
    }
}