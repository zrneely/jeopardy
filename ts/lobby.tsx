///<reference types="autobahn" />
///<reference types="react" />

import autobahn from 'autobahn';
import React from 'react';

import { ServerData, handleError } from './common';

const LOBBY_CHANNEL = "jpdy.chan.lobby";

interface LobbyState {
    openGames: ServerData.OpenGame[] | null,
    selectedGame: string | null,
}

export interface LobbyProps {
    session: autobahn.Session,
    makeGameCallback: (name: string) => void,
    joinGameCallback: (name: string, gameId: string) => void,
}

export class Lobby extends React.Component<LobbyProps, LobbyState> {
    state: LobbyState = {
        openGames: null,
        selectedGame: null,
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
            this.props.makeGameCallback(this.userNameRef.current.value);
        }
    }

    handleJoinGameClick() {
        if ((this.userNameRef.current !== null) && (this.state.selectedGame !== null)) {
            this.props.joinGameCallback(this.userNameRef.current.value, this.state.selectedGame);
        }
    }

    handleChangeSelectedGame(e: React.ChangeEvent<HTMLInputElement>) {
        this.setState({
            selectedGame: e.target.value,
        });
    }

    render() {
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
                                    {openGame.players.map((player) => {
                                        return <li>{player}</li>;
                                    })}
                                </ul>
                            </label>
                        </li>
                    );
                })}
            </ul>;
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
                <input type="text" name="name" ref={this.userNameRef} />
                <input type="button" id="make-game" value="Make Game" onClick={this.handleMakeGameClick} />
                <input type="button" id="join-game" value="Join Selected Game" onClick={this.handleJoinGameClick} />
                <hr />
                <small>Games created more than 24 hours ago are automatically deleted.</small>
            </div>
        </div>;
    }
}