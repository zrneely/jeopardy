///<reference types="autobahn" />
///<reference types="react" />
///<reference types="react-dom" />
///<reference types="react-ga" />
///<reference types="lodash.debounce" />

import autobahn from 'autobahn';
import React from 'react';
import ReactDOM from 'react-dom';
import ReactGA from 'react-ga';

import { Lobby } from './lobby';
import { Game } from './game';
import {
  GameJoinInfo,
  handleError,
  JeopardyContext,
  GlobalMetadata,
  JeopardyContextClass,
  ConfigData,
  LS_KEY_CUR_GAME
} from './common';

const WAMP_REALM = "jpdy";

interface JeopardyProps {
  configPromise: Promise<ConfigData>,
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
    const mountTime = Date.now();

    const existingGameData = localStorage.getItem(LS_KEY_CUR_GAME);
    if (existingGameData !== null) {
      this.setState({
        joinInfo: JSON.parse(existingGameData),
      });
    }

    this.props.configPromise.then((config) => {
      this.setState({
        routerUrl: config.routerUrl,
      });

      if (config.gaIdentifier !== undefined) {
        let debug = false;
        if (config.debug !== undefined) {
          debug = true;
        }

        let gaSampleRate = 100;
        if (config.gaSampleRate !== undefined) {
          gaSampleRate = config.gaSampleRate;
        }

        ReactGA.initialize(config.gaIdentifier, {
          debug,
          titleCase: false,
          gaOptions: {
            siteSpeedSampleRate: gaSampleRate,
            allowAnchor: false,
            storage: 'none'
          }
        });
      }

      this.connection = new autobahn.Connection({
        url: config.routerUrl,
        realm: WAMP_REALM,
        max_retries: 3,
        max_retry_delay: 15, // seconds
      });

      this.connection.onopen = (session) => {
        const connectionOpenTime = Date.now();
        console.log('WAMP connection open!');

        this.setState({
          session: session,
        });

        ReactGA.event({
          category: 'Navigation',
          action: 'Connected to server',
        });
      };

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

    const callTime = Date.now();
    console.log(`joining game ${gameId}`);
    this.state.session.call<autobahn.Result>('jpdy.join', [], {
      player_name: playerName,
      game_id: gameId,
      avatar,
    }).then((result) => {
      const responseTime = Date.now();
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

      ReactGA.event({
        category: 'Navigation',
        action: 'Joined a game',
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

    ReactGA.event({
      category: 'Navigation',
      action: 'Spectated a game',
    });
  }

  leaveGame() {
    localStorage.removeItem(LS_KEY_CUR_GAME);

    this.setState({
      joinInfo: null,
    });

    ReactGA.event({
      category: 'Navigation',
      action: 'Left a game',
    });
  }

  makeGame(playerName: string, avatar: string) {
    if (this.state.session === null) {
      console.warn('session is null when starting game!');
      return;
    }

    const callTime = Date.now();
    this.state.session.call<autobahn.Result>('jpdy.new_game', [], {
      player_name: playerName,
      avatar,
    }).then((result) => {
      const responseTime = Date.now();
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

      ReactGA.event({
        category: 'Navigation',
        action: 'Created a game',
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
        gotGlobalMetadataCallback={this.gotMetadata} />;
    }

    return <JeopardyContext.Provider value={new JeopardyContextClass(
      this.state.session, this.state.joinInfo,
      this.state.minCategoryYear, this.state.maxCategoryYear,
    )}>
      {component}
    </JeopardyContext.Provider>;
  }
}

const configPromise: Promise<ConfigData> = fetch('config.json')
  .then(resp => resp.json());
ReactDOM.render(
  <Jeopardy configPromise={configPromise} />,
  document.querySelector('#root')
);