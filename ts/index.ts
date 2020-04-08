///<reference types="autobahn" />

import autobahn from 'autobahn';

const LOBBY_CHANNEL = "jpdy.chan.lobby";
const WAMP_REALM = "jpdy";
//const WS_SERVER = "ws://jpdy-1.cloudsynrgy.solutions/ws";
const WS_SERVER = "ws://127.0.0.1:8080/ws";
const LS_KEY_CUR_GAME = "curGame";

interface OpenGame {
  game_id: string;
  moderator: string;  // name
  players: [string];  // names
}

interface Game {
  gameId: string,
  playerId: string,
  token: string,
  channel: string,
  isModerator: boolean,
}

interface GlobalState {
  openGames: Array<OpenGame>;
  openGamesKnown: boolean,
  players: { [playerId: string]: string },
  lobbySubscription: autobahn.Subscription | null,
}

let GLOBAL_STATE: GlobalState = {
  openGames: [],
  openGamesKnown: false,
  players: {},
  lobbySubscription: null,
};

function handleError(msg: string, error: any) {
  console.log(`${msg}: ${JSON.stringify(error)}`);
  alert(msg);
}

function populateOpenGames(games: OpenGame[]) {
  GLOBAL_STATE.openGamesKnown = true;

  const container = document.querySelector('#open-games-container');
  while (container?.firstChild) {
    container.removeChild(container.firstChild);
  }

  const list = document.createElement('ul');
  for (let i = 0; i < games.length; i++) {
    const newEleInp = document.createElement('input');
    newEleInp.setAttribute('type', 'radio');
    newEleInp.setAttribute('type', 'radio');
    newEleInp.setAttribute('id', `game-to-join-${i}`);
    newEleInp.setAttribute('name', 'game-to-join');
    newEleInp.dataset.game_data = JSON.stringify(games[i]);

    const newEleLbl = document.createElement('label');
    newEleLbl.setAttribute('for', `game-to-join-${i}`);
    newEleLbl.innerHTML = `${JSON.parse(games[i].moderator)}'s Game`;

    const li = document.createElement('li');
    li.appendChild(newEleInp);
    li.appendChild(newEleLbl);

    list.appendChild(li);
    GLOBAL_STATE.openGames.push(games[i]);
  }

  container?.appendChild(list);
}

function joinLobby(session: autobahn.Session) {
  // Request the initial list of games
  session.call('jpdy.list_games').then((result: unknown) => {
    console.log('initial open games call succeeded');
    const openGames = JSON.parse((<autobahn.Result>result).kwargs['games']);
    populateOpenGames(openGames);
  }, (error: any) => {
    handleError('initial open games request failed', error);
  });

  // Subscribe to the lobby channel.
  session.subscribe(LOBBY_CHANNEL, (_, kwargs) => {
    console.log('updating list of open games');
    const openGames = JSON.parse(kwargs['games']);
    populateOpenGames(openGames);
  }).then((subscription: autobahn.Subscription) => {
    console.log('subscription to lobby channel open');
    GLOBAL_STATE.lobbySubscription = subscription;
  }, (error: any) => {
    handleError('subscription to lobby channel failed', error);
  });
}

// Join a game. Note that the game data must include a game ID and auth token, so we're already "in
// the game" according to the server. This just sets up the UI and subscriptions.
function joinGame(session: autobahn.Session, game: Game) {
  // Save the information needed to rejoin the game to local storage
  localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(game));

  // Make the UI: TODO
  const container = document.querySelector('#main-container');
  while (container?.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Unsubscribe from the lobby channel
  let lobbyUnsubscribePromise;
  if (GLOBAL_STATE.lobbySubscription !== null) {
    lobbyUnsubscribePromise = session.unsubscribe(GLOBAL_STATE.lobbySubscription);
  } else {
    lobbyUnsubscribePromise = Promise.resolve(null);
  }

  // Request the initial game state and subscribe to the update channel
  let requestPromise = session.call('jpdy.game_state', [], {
    'game_id': game.gameId,
    'player_id': game.playerId,
    'auth': game.token,
  });
  let stateSubscribePromise = session.subscribe(game.channel, (_, _update) => {
    // TODO
    // handleStateUpdate(update);
  });

  Promise.all([
    requestPromise,
    stateSubscribePromise,
    lobbyUnsubscribePromise,
  ]).then((_value) => {
    console.log('game subscriptions open');
    GLOBAL_STATE.lobbySubscription = null;

    // TODO
    // handleStateUpdate(value[0]);
  }, (error) => {
    localStorage.clear();
    handleError('game subscription/setup failed', error);
  });
};

function onReady() {
  // Open a connection to the WAMP router
  const connection = new autobahn.Connection({
    url: WS_SERVER,
    realm: WAMP_REALM,
  });

  connection.onopen = (session) => {
    console.log('game server connection open');

    // When "make game" is clicked... make a game.
    document.querySelector('#make-game')?.addEventListener('click', () => {
      const playerName = (<HTMLInputElement>document.querySelector('#name')).value;

      session.call('jpdy.new_game', [], {
        'player_name': JSON.stringify(playerName),
      }).then((resultUntyped) => {
        const result = <autobahn.Result>resultUntyped;
        console.log(`new_game result: ${JSON.stringify(result.kwargs)}`);

        const game: Game = {
          channel: JSON.parse(result.kwargs['moderator_channel']),
          gameId: JSON.parse(result.kwargs['game_id']),
          isModerator: true,
          playerId: JSON.parse(result.kwargs['player_id']),
          token: JSON.parse(result.kwargs['token']),
        };
        joinGame(session, game);
      }, function (error) {
        handleError('new game creation failed', error);
      });
    });

    // When "join game" is clicked, join a game.
    document.querySelector('#join-game')?.addEventListener('click', () => {
      const selected = document.querySelector('input[name=game-to-join]:checked');

      if (selected !== null) {
        const openGame: OpenGame = JSON.parse((<HTMLElement>selected).dataset.game_data || '');
        console.log(`joining game ${openGame.game_id}`);

        const playerName = (<HTMLInputElement>document.querySelector('#name')).value;

        session.call("jpdy.join", [], {
          'player_name': JSON.stringify(playerName),
          'game_id': openGame.game_id,
        }).then((resultUntyped) => {
          const result = <autobahn.Result>resultUntyped;
          console.log(`join result: ${JSON.stringify(result.kwargs)}`);

          const game: Game = {
            channel: JSON.parse(result.kwargs['channel']),
            playerId: JSON.parse(result.kwargs['player_id']),
            token: JSON.parse(result.kwargs['token']),
            gameId: openGame.game_id,
            isModerator: false,
          };
          joinGame(session, game);
        }, (error) => {
          handleError('joining game failed', error);
        });
      }
    });

    const existingGameData = localStorage.getItem(LS_KEY_CUR_GAME);
    if (existingGameData === null) {
      joinLobby(session);
    } else {
      joinGame(session, JSON.parse(existingGameData));
    }
  };

  connection.open();
}

function ready(fn: EventListener) {
  if (document.readyState !== 'loading') {
    fn.call(null, new Event('nothing'));
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

ready(onReady);
