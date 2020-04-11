///<reference types="autobahn" />
///<reference types="react" />
///<reference types="react-dom" />

import autobahn from 'autobahn';
import React from 'react';
import ReactDOM from 'react-dom';

import { Lobby } from './lobby';

const WAMP_REALM = "jpdy";
const LS_KEY_CUR_GAME = "curGame";

interface GameJoinInfo {
  gameId: string,
  playerId: string,
  token: string,
  channel: string,
}

interface JeopardyProps {
  routerUrl: string,
}

interface JeopardyState {
  session: autobahn.Session | null,
  current_game_data: GameJoinInfo | null,
}

class Jeopardy extends React.Component<JeopardyProps, JeopardyState> {
  state: JeopardyState = {
    session: null,
    current_game_data: null,
  };

  connection: autobahn.Connection | null = null;

  constructor(props: JeopardyProps) {
    super(props);

    this.joinGame = this.joinGame.bind(this);
    this.makeGame = this.makeGame.bind(this);
  }

  componentDidMount() {
    const existingGameData = localStorage.getItem(LS_KEY_CUR_GAME);
    if (existingGameData !== null) {
      this.setState({
        current_game_data: JSON.parse(existingGameData),
      });
    }

    this.connection = new autobahn.Connection({
      url: this.props.routerUrl,
      realm: WAMP_REALM,
    });

    this.connection.onopen = (session) => {
      console.log('game server connection open!');

      this.setState({
        session: session,
      });
    }

    this.connection.open();
  }

  componentWillUnmount() {
    if (this.connection !== null) {
      this.connection.close();
    }
  }

  joinGame(playerName: string, gameId: string) {
    if (this.state.session === null) {
      console.warn('session is null when joining game!');
      return;
    }

    console.log(`joining game ${gameId}`);
    this.state.session.call<autobahn.Result>('jpdy.join', [], {
      'player_name': playerName,
      'game_id': gameId,
    }).then((result) => {
      console.log(`join result: ${JSON.stringify(result.kwargs)}`);

      const game: GameJoinInfo = {
        channel: result.kwargs['channel'],
        gameId: gameId,
        playerId: result.kwargs['player_id'],
        token: result.kwargs['token'],
      };

      localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(game));

      this.setState({
        current_game_data: game,
      });
    }, (error) => {
      handleError('join game failed', error);
    });
  }

  makeGame(playerName: string) {
    if (this.state.session === null) {
      console.warn('session is null when starting game!');
      return;
    }

    console.log('making game');
    this.state.session.call<autobahn.Result>('jpdy.new_game', [], {
      'player_name': playerName,
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
        current_game_data: game,
      });
    }, (error) => {
      handleError('new game creation failed', error);
    });
  }

  render() {
    if (this.state.session === null) {
      return <div className="no-connection-msg">Connecting...</div>;
    }
    else if (this.state.current_game_data === null) {
      // We're in the lobby
      return <Lobby session={this.state.session} makeGameCallback={this.makeGame} joinGameCallback={this.joinGame} />;
    } else {
      return <h4>WIP</h4>;
    }
  }
}

// // Join a game. Note that the game data must include a game ID and auth token, so we're already "in
// // the game" according to the server. This just sets up the UI and subscriptions.
// function joinGame(session: autobahn.Session, game: GameJoinInfo) {
//   // Request the initial game state and subscribe to the update channel
//   let requestPromise = session.call<autobahn.Result>('jpdy.game_state', [], {
//     'game_id': game.gameId,
//     'player_id': game.playerId,
//     'auth': game.token,
//   });
//   let stateSubscribePromise = session.subscribe(game.channel, (_, update) => {
//     handleStateUpdate(update.kwargs);
//   });

//   Promise.all([
//     requestPromise,
//     stateSubscribePromise,
//   ]).then((value) => {
//     console.log('game subscriptions open');
//     GLOBAL_STATE.lobbySubscription = null;
//     handleStateUpdate(value[0].kwargs);
//   }, (error) => {
//     localStorage.clear();
//     handleError('game subscription/setup failed', error);
//   });
// };

ReactDOM.render(
  <Jeopardy routerUrl="ws://127.0.0.1:8080/ws" />,
  document.querySelector('#root')
);