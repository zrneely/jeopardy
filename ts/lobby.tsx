///<reference types="autobahn" />
///<reference types="react" />

import autobahn from 'autobahn';
import React from 'react';
import debounce from 'lodash.debounce';

import { ServerData, handleError } from './common';

const LOBBY_CHANNEL = "jpdy.chan.lobby";

namespace AvatarData {
    export const COLORS = [
        '81bef1',
        'ad8bf2',
        'bff288',
        'de7878',
        'a5aac5',
        '6ff2c5',
        'f0da5e',
        'eb5972',
        'f6be5d',
    ];
    export const EYES = [
        'eyes1',
        'eyes10',
        'eyes2',
        'eyes3',
        'eyes4',
        'eyes5',
        'eyes6',
        'eyes7',
        'eyes9',
    ];
    export const NOSES = [
        'nose2',
        'nose3',
        'nose4',
        'nose5',
        'nose6',
        'nose7',
        'nose8',
        'nose9',
    ];
    export const MOUTHS = [
        'mouth1',
        'mouth10',
        'mouth11',
        'mouth3',
        'mouth5',
        'mouth6',
        'mouth7',
        'mouth9',
    ];
}

interface LobbyState {
    openGames: ServerData.OpenGame[] | null,
    selectedGame: string | null,
    avatarUrl: string | null,
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
        avatarUrl: null,
    };

    private subscription: autobahn.Subscription | null = null;
    private userNameRef = React.createRef<HTMLInputElement>();

    constructor(props: LobbyProps) {
        super(props);

        this.handleJoinGameClick = this.handleJoinGameClick.bind(this);
        this.handleMakeGameClick = this.handleMakeGameClick.bind(this);
        this.handleChangeSelectedGame = this.handleChangeSelectedGame.bind(this);

        this.updateAvatar = debounce(this.updateAvatar.bind(this), 1000);
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
                this.props.makeGameCallback(this.userNameRef.current.value);
            }
        }
    }

    handleJoinGameClick() {
        if ((this.userNameRef.current !== null) && (this.state.selectedGame !== null)) {
            if (this.userNameRef.current.value.length !== 0) {
                this.props.joinGameCallback(this.userNameRef.current.value, this.state.selectedGame);
            }
        }
    }

    handleChangeSelectedGame(e: React.ChangeEvent<HTMLInputElement>) {
        this.setState({
            selectedGame: e.target.value,
        });
    }

    updateAvatar() {
        if (this.userNameRef.current !== null) {
            const name = this.userNameRef.current.value;
            if (name.length === 0) {
                this.setState({
                    avatarUrl: null,
                });
                return;
            }

            // Hash algorithm from here: https://stackoverflow.com/a/52171480
            let h1 = 0xDEADBEEF;
            let h2 = 0x41C6CE57;

            for (let i = 0; i < name.length; i++) {
                let chr = name.charCodeAt(i);
                h1 = Math.imul(h1 ^ chr, 2654435761);
                h2 = Math.imul(h2 ^ chr, 1597334677);
            }

            h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
            h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
            const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);

            console.log(`name hash: ${hash}`);

            // Hash is 53 bits, since that's the widest integer JS can represent.
            const color = AvatarData.COLORS[((hash >>> 0) & 0xFF) % AvatarData.COLORS.length];
            const eyes = AvatarData.EYES[((hash >>> 24) & 0xFF) % AvatarData.EYES.length];
            const nose = AvatarData.NOSES[((hash >> 32) & 0xFF) % AvatarData.NOSES.length];
            const mouth = AvatarData.MOUTHS[((hash >> 40) & 0xFF) % AvatarData.MOUTHS.length];

            this.setState({
                avatarUrl: `https://api.adorable.io/avatars/face/${eyes}/${nose}/${mouth}/${color}`,
            });
        }
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
                                    {openGame.players.map((player, i) => {
                                        return <li key={i}>{player}</li>;
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
                <input type="text" name="name" ref={this.userNameRef} onChange={this.updateAvatar} />
                <input type="button" id="make-game" value="Make Game" onClick={this.handleMakeGameClick} />
                <input type="button" id="join-game" value="Join Selected Game" onClick={this.handleJoinGameClick} />
                <hr />
                <small>Games created more than 24 hours ago are automatically deleted.</small>
            </div>
        </div>;
    }
}