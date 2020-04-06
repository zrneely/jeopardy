const LOBBY_CHANNEL = "ontm.chan.lobby";
const WAMP_REALM = "ontm";
//const WS_SERVER = "ws://ontm-1.cloudsynrgy.solutions/ws";
const WS_SERVER = "ws://127.0.0.1:8080/ws";

const CARDS = {
  "Dragon":     ["竜",     [[ 1, -2], [ 1,  2], [-1, -1], [-1,  1]]],
  "Tiger":      ["虎",     [[ 2,  0], [-1,  0]                    ]],
  "Frog":       ["蛙",     [[ 0, -2], [ 1, -1], [-1,  1]          ]],
  "Rabbit":     ["兔",     [[-1, -1], [ 1,  1], [ 0,  2]          ]],
  "Crab":       ["蟹",     [[ 0, -2], [ 0,  2], [ 1,  0]          ]],
  "Elephant":   ["象",     [[ 1, -1], [ 0, -1], [ 1,  1], [ 0,  1]]],
  "Goose":      ["鵞鳥",   [[ 1, -1], [ 0, -1], [ 0,  1], [-1,  1]]],
  "Rooster":    ["雄鶏",   [[ 0, -1], [-1, -1], [ 0,  1], [ 1,  1]]],
  "Monkey":     ["猿",     [[ 1, -1], [-1, -1], [ 1,  1], [-1,  1]]],
  "Mantis":     ["蟷螂",   [[ 1, -1], [-1,  0], [ 1,  1]          ]],
  "Horse":      ["馬",     [[ 0, -1], [ 1,  0], [-1,  0]          ]],
  "Ox":         ["牛",     [[ 1,  0], [-1,  0], [ 0,  1]          ]],
  "Crane":      ["鶴",     [[-1, -1], [ 1,  0], [-1,  1]          ]],
  "Boar":       ["猪",     [[ 0, -1], [ 1,  0], [ 0,  1]          ]],
  "Eel":        ["鰻",     [[ 1, -1], [-1, -1], [ 0,  1]          ]],
  "Cobra":      ["眼鏡蛇", [[ 0, -1], [ 1,  1], [-1,  1]          ]],
  "dummy":      ["loading",[                                      ]],
};

const PIECE_MAP = {
  "Empty": "&nbsp;",
  "WhiteKing": "&#9818;",
  "WhitePawn": "&#9823;",
  "BlackKing": "&#9818;",
  "BlackPawn": "&#9823;",
};

const LS_KEY_CUR_GAME = "curGame";
// {
//   "gameId": game id,
//   "color": color,
//   "token": auth token,
// }

window.openGames = [];
window.openGamesKnown = false;
window.playerNames = {
  "white": "",
  "black": "",
};
window.waitingForOpponent = true; // true when an opponent hasn't connected to the game yet
window.myMove = false; // true when it's our turn
window.selectedCard = -1; // 0 for the left, 1 for the right, -1 for no selection
window.selectedPiece = -1; // -1 for no selection
window.lobbySubscription = null; // the subscription for the lobby channel

const handleError = function(msg, error) {
  console.log(msg + ": " + JSON.stringify(error));
  alert(msg);
};

// row, column offsets from (0, 0), the bottom left corner of the board, White's left-most piece.
// idx counts from 1 (top-left corner, Black's left-most piece (from White's perspective))
const idxFromCoords = function(row, col) {
  return 1 + (5 * (4 - row)) + col;
};
const coordsFromIdx = function(idx) {
  return {
    row: 4 - Math.floor(idx / 5),
    col: idx % 5,
  };
};
const squareFromCoords = function(row, col) {
  return squareFromIdx(idxFromCoords(row, col));
};
const squareFromIdx = function(idx) {
  return $("#game-board .container > div:nth-child(" + idx + ")");
};

const populateOpenGames = function(games) {
  window.openGamesKnown = true;

  const $container = $("#open-games-container");
  $container.empty();

  const $list = $("<ul>");
  for (var i = 0; i < games.length; i++) {
    const $newEleInp = $("<input>");
    $newEleInp.attr("type", "radio");
    $newEleInp.attr("id", "game-to-join-" + i);
    $newEleInp.attr("name", "game-to-join");
    $newEleInp.data("game-id", games[i][0]);

    const $newEleLbl = $("<label>");
    $newEleLbl.attr("for", "game-to-join-" + i);
    $newEleLbl.html(games[i][1] + "'s Game");

    const $li = $("<li>");
    $li.append($newEleInp);
    $li.append($newEleLbl);

    $list.append($li);

    window.openGames.push({"gameId": games[i][0], "gameOwner": games[i][1]});
  }

  $container.append($list);
};

// Join the global lobby
const joinLobby = function(session) {
  // Request the initial list of games
  session.call("ontm.open_games").then(function(result) {
    session.log("initial open games call succeeded");
    populateOpenGames(JSON.parse(result.kwargs.games));
  }, function(error) {
    handleError("initial open games request failed", error);
  });

  // Subscribe to the lobby channel
  session.subscribe(LOBBY_CHANNEL, function(_, kwargs) {
    session.log("updating list of open games");
    populateOpenGames(JSON.parse(kwargs.games));
  }).then(function(subscription) {
    session.log("subscription to lobby channel open");
    window.lobbySubscription = subscription;
  }, function(error) {
    handleError("subscription to lobby channel failed", error);
  });
};

const setSelectedPiece = function(idx, myColor) {
  window.selectedPiece = idx;
  $("#game-board .container > div").removeClass("move-target");
  $("#game-board .container > div").removeClass("selected");

  if (idx === -1 || window.selectedCard === -1 || window.waitingForOpponent) {
    return;
  }

  const coords = coordsFromIdx(idx);
  const $selectedPiece = squareFromCoords(coords.row, coords.col);

  $selectedPiece.addClass("selected");

  const $selectedCard = $("#my-cards > .card:nth-child(" + (window.selectedCard + 1) + ")");
  const moves = JSON.parse($selectedCard.data("moves"));

  for (var i = 0; i < moves.length; i++) {
    const reverse = (myColor === "White") ? 1 : -1;
    const targetRow = coords.row + (reverse * moves[i][0]);
    const targetCol = coords.col + (reverse * moves[i][1]);
    if (targetRow >= 0 && targetRow < 5 && targetCol >= 0 && targetCol < 5) {
      const $target = squareFromCoords(targetRow, targetCol);
      const targetPiece = $target.data("piece");
      if (!targetPiece.startsWith(myColor)) {
        $target.addClass("move-target");
      }
    }
  }
};

const buildGameBoard = function($container, gameData, session) {
  const $board = $("<div>");
  $board.addClass("container");

  if (gameData.color === "Black") {
    $board.addClass("flipped");
  }

  // CSS is amazing
  for (var i = 0; i < 25; i++) {
    const $sq = $("<div>");
    $sq.html("&nbsp;");

    $sq.on("click", function() {
      const $this = $(this);
      if (
        !window.waitingForOpponent &&
        $this.hasClass("move-target") &&
        window.selectedPiece !== -1 &&
        window.selectedCard !== -1 &&
        window.myMove
      ) {
        console.log("making move!");
        const targetCoords = coordsFromIdx($this.index());
        const pieceCoords = coordsFromIdx(window.selectedPiece);

        let moveIdx = -1;
        const moves = JSON.parse(
          $("#my-cards > div:nth-child(" + (window.selectedCard + 1) + ")").data("moves")
        );
        for (var i = 0; i < moves.length; i++) {
          const moveDest = (gameData.color === "White") ? {
            row: pieceCoords.row + moves[i][0],
            col: pieceCoords.col + moves[i][1],
          } : {
            row: pieceCoords.row - moves[i][0],
            col: pieceCoords.col - moves[i][1],
          }
          if (moveDest.row === targetCoords.row && moveDest.col === targetCoords.col) {
            moveIdx = i;
            break;
          }
        }
        if (moveIdx === -1) {
          alert("cheater!");
          return;
        }

        const args = {
          game_id: JSON.stringify(gameData.gameId),
          who: JSON.stringify(gameData.color),
          auth: JSON.stringify(gameData.token),
          which: JSON.stringify(["Left", "Right"][window.selectedCard]),
          idx: JSON.stringify(moveIdx),
          row: JSON.stringify(pieceCoords.row),
          col: JSON.stringify(pieceCoords.col),
        };

        // The server will publish a state update to the sys channel
        session.call("ontm.move", [], args).then(function() {
          session.log("move RPC succeeded");
          $(".card").removeClass("selected");
          window.selectedCard = -1;
          setSelectedPiece(-1);
        }, function(error) {
          handleError("make move RPC failed", error);
        });
      } else if ($this.data("piece").startsWith(gameData.color)) {
        const myIdx = $this.index();
        if (myIdx === window.selectedPiece) {
          setSelectedPiece(-1);
        } else {
          setSelectedPiece($this.index(), gameData.color);
        }
      }
    });
    $board.append($sq);
  }

  $container.append($board);
};

const makeDotGrid = function(moves) {
  const $ele = $("<div>");
  $ele.addClass("dot-grid");

  for (var i = 0; i < 25; i++) {
    const $dot = $("<div>");
    $dot.html("&nbsp;");
    $ele.append($dot);
  }

  for (var i = 0; i < moves.length; i++) {
    // 12 is the center but css counts children from 1
    const idx = idxFromCoords(2 + moves[i][0], 2 + moves[i][1]);
    $ele.find("div:nth-child(" + idx + ")").addClass("movable");
  }

  return $ele;
};

const makeCard = function(name) {
  const kanji = CARDS[name][0];
  const moves = CARDS[name][1];

  const $ele = $("<div>");
  $ele.addClass("card");

  const $dots = makeDotGrid(moves);
  $ele.append($dots);

  const $name = $("<div>");
  $name.addClass("name");
  $name.html(name);
  $ele.append($name);

  const $kanji = $("<div>");
  $kanji.addClass("kanji");
  $kanji.html(kanji);
  $ele.append($kanji);

  $ele.on("click", function() {
    if (window.waitingForOpponent) {
      return;
    }
    const $this = $(this);
    // Don't do anything for cards that aren't mine
    if ($this.parents("#my-cards").length === 0) {
      return;
    }

    const wasSelected = $this.hasClass("selected");
    $(".card").removeClass("selected");
    setSelectedPiece(-1);

    if (wasSelected) {
      window.selectedCard = -1;
    } else {
      window.selectedCard = $this.index();
      $this.addClass("selected");
    }
  });
  $ele.data("moves", JSON.stringify(moves));

  return $ele;
};

const setPlayerNames = function(myColor, white, black) {
  window.playerNames.white = white;
  window.playerNames.black = black;

  if (white !== null && black !== null) {
    window.waitingForOpponent = false;
    $("#waiting-for-opponent").remove();
    alert(white + " and " + black + " are now playing together! How cute :)");
  }
};

// Returns true if it consumed the input (i.e., it should not be sent as a message).
const processCommand = function(text, session, gameData) {
  const commandEnd = text.indexOf(" ");
  const command = text.slice(1, commandEnd !== -1 ? commandEnd : 100);
  return (COMMANDS[command] || function() { return false; }).call(null, text, session, gameData);
};

const handleStateUpdate = function(stateWrapper, myColor) {
  // If we have updated player names, handle that
  if (stateWrapper.kwargs.hasOwnProperty("white")) {
    setPlayerNames(
      myColor,
      JSON.parse(stateWrapper.kwargs.white),
      JSON.parse(stateWrapper.kwargs.black)
    );
  }

  const state = JSON.parse(stateWrapper.kwargs.state);

  // Update our "can do things" flag
  window.myMove = (state.next_turn === myColor);

  // Update the board UI
  $("#game-board .container > div").html("&nbsp;");
  $("#game-board .container > div").data("piece", "");
  for (var i = 0; i < 5; i++) {
    for (var j = 0; j < 5; j++) {
      // Put the pieces onto the board
      const pieceType = state.board[i][j];
      const $square = squareFromCoords(i, j);
      $square.removeClass();

      if (pieceType.startsWith("White")) {
        $square.addClass("white");
      } else if (pieceType.startsWith("Black")) {
        $square.addClass("black");
      }

      if (pieceType.startsWith(myColor)) {
        $square.addClass("friendly");
      }

      $square.html(PIECE_MAP[pieceType]);
      $square.data("piece", pieceType);
    }
  }

  if (stateWrapper.kwargs.hasOwnProperty("winner")) {
    const winner = JSON.parse(stateWrapper.kwargs.winner);
    if (winner !== null) {
      window.waitingForOpponent = true;
      localStorage.clear();

      if (winner !== null && winner === myColor) {
        alert("You win! Reload the page to re-join the lobby.");
      } else {
        alert("You lose. Reload the page to re-join the lobby.");
      }
    }
  }

  // Fill in both player's cards
  const myCards = (myColor === "White") ? state.cards.white : state.cards.black;
  const opponentCards = (myColor === "White") ? state.cards.black : state.cards.white;

  const $opponentCards = $("#opponent-cards");
  $opponentCards.empty();
  $opponentCards.append(makeCard(opponentCards[0].name));
  $opponentCards.append(makeCard(opponentCards[1].name));

  const $myCards = $("#my-cards");
  $myCards.empty();
  $myCards.append(makeCard(myCards[0].name));
  $myCards.append(makeCard(myCards[1].name));

  const $suspendedCard = $("#suspended-card");
  $suspendedCard.empty();
  $suspendedCard.append(makeCard(state.cards.suspended.name));

  if (window.myMove) {
    $suspendedCard.removeClass("flipped");
  } else {
    $suspendedCard.addClass("flipped");
  }
};

// Join a game. Note that the game data must include a game ID and auth token, so we're already "in
// the game" according to the server. This just sets up the UI and subscriptions.
const joinGame = function(session, gameData) {
  // First, make the UI
  const $container = $("#main-container");
  $container.empty();

  const $cards = $("<div>");
  $cards.attr("id", "card-container");

  // Add the "waiting for opponent" message. setPlayerNames will clear it if needed.
  const $waitingForOpponent = $("<div>");
  $waitingForOpponent.attr("id", "waiting-for-opponent");
  $waitingForOpponent.html("Waiting for opponent...");
  $cards.append($waitingForOpponent);

  // Build the cards off to the side.
  const $opponentCards = $("<div>");
  $opponentCards.attr("id", "opponent-cards");
  $opponentCards.append(makeCard("dummy"));
  $opponentCards.append(makeCard("dummy"));
  $cards.append($opponentCards);

  const $suspendedCard = $("<div>");
  $suspendedCard.attr("id", "suspended-card");
  $suspendedCard.append(makeCard("dummy"));
  $cards.append($suspendedCard);

  const $myCards = $("<div>");
  $myCards.attr("id", "my-cards");
  $myCards.append(makeCard("dummy"));
  $myCards.append(makeCard("dummy"));
  $cards.append($myCards);

  // Build the game board.
  const $game = $("<div>");
  $game.attr("id", "game");

  const $gameBoard = $("<div>");
  $gameBoard.attr("id", "game-board");
  buildGameBoard($gameBoard, gameData, session);
  $game.append($gameBoard);

  $container.append($cards);
  $container.append($game);

  // Unsubscribe from the lobby channel
  let lobbyUnsubscribePromise;
  if (window.lobbySubscription !== null) {
    lobbyUnsubscribePromise = session.unsubscribe(window.lobbySubscription);
  } else {
    lobbyUnsubscribePromise = Promise.resolve(null);
  }

  // Request the initial game state and subscribe to the update channel
  let requestPromise = session.call("ontm.game_state", [], {
    "game_id": JSON.stringify(gameData.gameId),
  });
  let sysSubscribePromise = session.subscribe(
    "ontm.chan.game." + gameData.gameId + ".sys",
    function(_, update) {
      handleStateUpdate({kwargs: update}, gameData.color);
    }
  );
  Promise.all([
    requestPromise,
    sysSubscribePromise,
    lobbyUnsubscribePromise,
  ]).then(function(v) {
    session.log("game subscriptions open");
    window.lobbySubscription = null;
    setPlayerNames(
      gameData["color"],
      JSON.parse(v[0].kwargs.white),
      JSON.parse(v[0].kwargs.black)
    );
    handleStateUpdate(v[0], gameData.color);
  }, function(error) {
    localStorage.clear();
    handleError("game subscriptions/setup failed", error);
  });
};

$(function() {
  // Open a connection to the WAMP router
  const connection = new autobahn.Connection({
    url: WS_SERVER,
    realm: WAMP_REALM,
  });

  connection.onopen = function(session) {
    session.log("game server connection open");

    // When "make game" is clicked... make a game.
    $("#make-game").on("click", function() {
      session.call("jpdy.new_game", [], {
        "player_name": JSON.stringify($("#name").val()),
      }).then(function(result) {
        session.log("new_game result: " + JSON.stringify(result.kwargs));
        const gameData = {
          "gameId": JSON.parse(result.kwargs.game_id),
          "color": JSON.parse(result.kwargs.assigned_color),
          "token": JSON.parse(result.kwargs.token),
        };
        localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(gameData));
        joinGame(session, gameData);
      }, function(error) {
        handleError("new game creation failed", error);
      });
    });

    // When "join game" is clicked, join a game.
    $("#join-game").on("click", function() {
      const $selected = $("input[name=game-to-join]:checked");
      if ($selected.length > 0) {
        const gameIdToJoin = $selected.data("game-id");
        session.log("joining game " + gameIdToJoin);
        session.call("ontm.join", [], {
          "player_name": JSON.stringify($("#name").val()),
          "game_id": JSON.stringify(gameIdToJoin),
        }).then(function(result) {
          session.log("join result: " + JSON.stringify(result.kwargs));
          const gameData = {
            "gameId": gameIdToJoin,
            "color": JSON.parse(result.kwargs.assigned_color),
            "token": JSON.parse(result.kwargs.token),
          };
          localStorage.setItem(LS_KEY_CUR_GAME, JSON.stringify(gameData));
          joinGame(session, gameData);
        }, function(error) {
          handleError("joining game failed", error);
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
});
