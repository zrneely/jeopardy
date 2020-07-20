///<reference types="autobahn" />
///<reference types="react" />
///<reference types="react-dom" />
///<reference types="lodash.debounce" />

import autobahn from 'autobahn';
import React from 'react';
import ReactDOM from 'react-dom';

import { Lobby } from './lobby';
import { Game } from './game';
import {
  GameJoinInfo,
  handleError,
  JeopardyContext,
  GlobalMetadata,
  JeopardyContextClass,
  LS_KEY_CUR_GAME
} from './common';

const WAMP_REALM = "jpdy";

interface JeopardyProps {
  routerUrlPromise: Promise<string>,
}

interface JeopardyState extends GlobalMetadata {
  routerUrl: string | null,
}

class Jeopardy extends React.Component<JeopardyProps, JeopardyState> {
  state: JeopardyState = {
    routerUrl: null,
    session: null,
    joinInfo: null,
    minCategoryYear: null,
    maxCategoryYear: null,
  };

  connection: autobahn.Connection | null = null;

  constructor(props: JeopardyProps) {
    super(props);

    this.joinGame = this.joinGame.bind(this);
    this.makeGame = this.makeGame.bind(this);
    this.spectateGame = this.spectateGame.bind(this);
    this.leaveGame = this.leaveGame.bind(this);
    this.gotMetadata = this.gotMetadata.bind(this);
  }

  componentDidMount() {
    const existingGameData = localStorage.getItem(LS_KEY_CUR_GAME);
    if (existingGameData !== null) {
      this.setState({
        joinInfo: JSON.parse(existingGameData),
      });
    }

    this.props.routerUrlPromise.then((routerUrl) => {
      this.setState({
        routerUrl,
      });

      this.connection = new autobahn.Connection({
        url: routerUrl,
        realm: WAMP_REALM,
        max_retries: 3,
        max_retry_delay: 15, // seconds
      });

      this.connection.onopen = (session) => {
        console.log('WAMP connection open!');

        this.setState({
          session: session,
        });
      }

      this.connection.open();
    });
  }

  componentWillUnmount() {
    if (this.connection !== null) {
      this.connection.close();
      this.connection = null;
    }
  }

  joinGame(playerName: string, avatar: string, gameId: string) {
    if (this.state.session === null) {
      console.warn('session is null when joining game!');
      return;
    }

    console.log(`joining game ${gameId}`);
    this.state.session.call<autobahn.Result>('jpdy.join', [], {
      player_name: playerName,
      game_id: gameId,
      avatar,
    }).then((result) => {
      console.log(`join result: ${JSON.stringify(result.kwargs)}`);

      const joinInfo = {
        channel: result.kwargs['channel'],
        gameId: gameId,
        playerId: result.kwargs['player_id'],
        token: result.kwargs['token'],
      };

      localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(joinInfo));

      this.setState({
        joinInfo,
      });
    }, (error) => {
      handleError('join game failed', error, true);
    });
  }

  spectateGame(gameId: string, channel: string) {
    const joinInfo = {
      channel,
      gameId,
      playerId: null,
      token: null,
    };
    localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(joinInfo));

    this.setState({
      joinInfo,
    });
  }

  leaveGame() {
    localStorage.removeItem(LS_KEY_CUR_GAME);
    this.setState({
      joinInfo: null,
    });
  }

  makeGame(playerName: string, avatar: string) {
    if (this.state.session === null) {
      console.warn('session is null when starting game!');
      return;
    }

    this.state.session.call<autobahn.Result>('jpdy.new_game', [], {
      player_name: playerName,
      avatar,
    }).then((result) => {
      console.log(`new_game result: ${JSON.stringify(result.kwargs)}`);

      const game: GameJoinInfo = {
        channel: result.kwargs['moderator_channel'],
        gameId: result.kwargs['game_id'],
        playerId: result.kwargs['player_id'],
        token: result.kwargs['token'],
      };

      localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(game));

      this.setState({
        joinInfo: game,
      });
    }, (error) => {
      handleError('new game creation failed', error, true);
    });
  }

  gotMetadata(minCategoryYear: number, maxCategoryYear: number) {
    this.setState({
      minCategoryYear,
      maxCategoryYear,
    });
  }

  render() {
    let component;
    if (this.state.session === null) {
      component = <div className="no-connection-msg">Connecting...</div>;
    }
    else if (this.state.joinInfo === null) {
      // We're in the lobby
      component = <Lobby
        session={this.state.session}
        makeGameCallback={this.makeGame}
        joinGameCallback={this.joinGame}
        spectateGameCallback={this.spectateGame}
        gotGlobalMetadataCallback={this.gotMetadata} />;
    } else {
      // We're in a game
      component = <Game
        leaveGameCallback={this.leaveGame}
        gotGlobalMetadataCallback={this.gotMetadata} />
    }

    return <JeopardyContext.Provider value={new JeopardyContextClass(
      this.state.session, this.state.joinInfo,
      this.state.minCategoryYear, this.state.maxCategoryYear,
    )}>
      {component}
    </JeopardyContext.Provider>;
  }
}

const routerUrlPromise: Promise<string> = fetch('config.json')
  .then(resp => resp.json())
  .then(data => data['routerUrl']);
ReactDOM.render(
  <Jeopardy routerUrlPromise={routerUrlPromise} />,
  document.querySelector('#root')
);