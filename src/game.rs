use std::{default::Default, fmt, mem};

use log::*;
use rand::{seq::SliceRandom, thread_rng};
use serde::{Deserialize, Serialize};

macro_rules! card {
    ($name:expr, $kanji:expr, [($r1:expr,$c1:expr),($r2:expr,$c2:expr),($r3:expr,$c3:expr),($r4:expr,$c4:expr)]) => {
        Card {
            name: $name,
            kanji: $kanji,
            moves: CardMovement::Four([
                Movement {
                    rows: $r1,
                    cols: $c1,
                },
                Movement {
                    rows: $r2,
                    cols: $c2,
                },
                Movement {
                    rows: $r3,
                    cols: $c3,
                },
                Movement {
                    rows: $r4,
                    cols: $c4,
                },
            ]),
        }
    };

    ($name:expr, $kanji:expr, [($r1:expr,$c1:expr),($r2:expr,$c2:expr),($r3:expr,$c3:expr)]) => {
        Card {
            name: $name,
            kanji: $kanji,
            moves: CardMovement::Three([
                Movement {
                    rows: $r1,
                    cols: $c1,
                },
                Movement {
                    rows: $r2,
                    cols: $c2,
                },
                Movement {
                    rows: $r3,
                    cols: $c3,
                },
            ]),
        }
    };

    ($name:expr, $kanji:expr, [($r1:expr,$c1:expr),($r2:expr,$c2:expr)]) => {
        Card {
            name: $name,
            kanji: $kanji,
            moves: CardMovement::Two([
                Movement {
                    rows: $r1,
                    cols: $c1,
                },
                Movement {
                    rows: $r2,
                    cols: $c2,
                },
            ]),
        }
    };
}

// Moves are rows up, columns right. Origin is bottom left square (white's leftmost pawn).
const CARDS: [Card; 16] = [
    card!("Dragon", "竜", [(1, -2), (1, 2), (-1, -1), (-1, 1)]),
    card!("Tiger", "虎", [(2, 0), (-1, 0)]),
    card!("Frog", "蛙", [(0, -2), (1, -1), (-1, 1)]),
    card!("Rabbit", "兔", [(-1, -1), (1, 1), (0, 2)]),
    card!("Crab", "蟹", [(0, -2), (0, 2), (1, 0)]),
    card!("Elephant", "象", [(1, -1), (0, -1), (1, 1), (0, 1)]),
    card!("Goose", "鵞鳥", [(1, -1), (0, -1), (0, 1), (-1, 1)]),
    card!("Rooster", "雄鶏", [(0, -1), (-1, -1), (0, 1), (1, 1)]),
    card!("Monkey", "猿", [(1, -1), (-1, -1), (1, 1), (-1, 1)]),
    card!("Mantis", "蟷螂", [(1, -1), (-1, 0), (1, 1)]),
    card!("Horse", "馬", [(0, -1), (1, 0), (-1, 0)]),
    card!("Ox", "牛", [(1, 0), (-1, 0), (0, 1)]),
    card!("Crane", "鶴", [(-1, -1), (1, 0), (-1, 1)]),
    card!("Boar", "猪", [(0, -1), (1, 0), (0, 1)]),
    card!("Eel", "鰻", [(1, -1), (-1, -1), (0, 1)]),
    card!("Cobra", "眼鏡蛇", [(0, -1), (1, 1), (-1, 1)]),
];

#[derive(Debug, Clone, Serialize)]
struct Movement {
    rows: i8,
    cols: i8,
}

// Only send the name of the card; the client can figure it out from there.
#[derive(Debug, Clone, Serialize)]
struct Card {
    name: &'static str,
    #[serde(skip_serializing)]
    kanji: &'static str,
    #[serde(skip_serializing)]
    moves: CardMovement,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum CardMovement {
    Two([Movement; 2]),
    Three([Movement; 3]),
    Four([Movement; 4]),
}
impl CardMovement {
    fn get(&self, idx: u8) -> Option<Movement> {
        use self::CardMovement::*;

        Some(match (self, idx) {
            (&Two(ref moves), 0) => moves[0].clone(),
            (&Two(ref moves), 1) => moves[1].clone(),
            (&Three(ref moves), 0) => moves[0].clone(),
            (&Three(ref moves), 1) => moves[1].clone(),
            (&Three(ref moves), 2) => moves[2].clone(),
            (&Four(ref moves), 0) => moves[0].clone(),
            (&Four(ref moves), 1) => moves[1].clone(),
            (&Four(ref moves), 2) => moves[2].clone(),
            (&Four(ref moves), 3) => moves[3].clone(),
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum CardSlot {
    Left,
    Right,
}

#[derive(Debug, Serialize)]
struct Cards {
    black: [Card; 2],
    white: [Card; 2],
    suspended: Card,
}
impl Cards {
    /// Gets the row, col change.
    fn get_move(&self, who: Player, which: CardSlot, idx: u8) -> Option<Movement> {
        match (who, which) {
            (Player::White, CardSlot::Left) => &self.white[0],
            (Player::White, CardSlot::Right) => &self.white[1],
            (Player::Black, CardSlot::Left) => &self.black[0],
            (Player::Black, CardSlot::Right) => &self.black[1],
        }
        .moves
        .get(idx)
    }

    // Returns the name of the card which was played.
    fn play(&mut self, who: Player, which: CardSlot) -> &str {
        mem::swap(
            &mut self.suspended,
            match (who, which) {
                (Player::White, CardSlot::Left) => &mut self.white[0],
                (Player::White, CardSlot::Right) => &mut self.white[1],
                (Player::Black, CardSlot::Left) => &mut self.black[0],
                (Player::Black, CardSlot::Right) => &mut self.black[1],
            },
        );
        &self.suspended.name
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
enum Piece {
    Empty,
    BlackPawn,
    BlackKing,
    WhitePawn,
    WhiteKing,
}
impl Piece {
    fn get_player(self) -> Option<Player> {
        use self::Piece::*;

        match self {
            Empty => None,
            BlackPawn | BlackKing => Some(Player::Black),
            WhitePawn | WhiteKing => Some(Player::White),
        }
    }
}

#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub enum Player {
    Black,
    White,
}
impl Player {
    pub fn opponent(self) -> Player {
        match self {
            Player::Black => Player::White,
            Player::White => Player::Black,
        }
    }
}
impl fmt::Display for Player {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        write!(
            fmt,
            "{}",
            match *self {
                Player::Black => "Black",
                Player::White => "White",
            }
        )
    }
}

#[derive(Debug, Serialize)]
pub struct Game {
    board: [[Piece; 5]; 5],
    turn_count: u32,
    cards: Cards,
    next_turn: Player,
    #[serde(skip_serializing)]
    resigned: Option<Player>,
}
impl Default for Game {
    fn default() -> Self {
        use self::Piece::*;

        Game {
            board: [
                [WhitePawn, WhitePawn, WhiteKing, WhitePawn, WhitePawn],
                [Empty; 5],
                [Empty; 5],
                [Empty; 5],
                [BlackPawn, BlackPawn, BlackKing, BlackPawn, BlackPawn],
            ],
            turn_count: 0,
            cards: {
                let mut card_list = CARDS.clone().to_vec();
                card_list.shuffle(&mut thread_rng());
                Cards {
                    black: [card_list.pop().unwrap(), card_list.pop().unwrap()],
                    white: [card_list.pop().unwrap(), card_list.pop().unwrap()],
                    suspended: card_list.pop().unwrap(),
                }
            },
            next_turn: Player::White,
            resigned: None,
        }
    }
}
impl Game {
    /// Gets the winner of the game.
    #[allow(clippy::if_same_then_else)]
    pub fn get_winner(&self) -> Option<Player> {
        if self.board[0][2] == Piece::BlackKing {
            Some(Player::Black)
        } else if self.board[4][2] == Piece::WhiteKing {
            Some(Player::White)
        } else if self
            .board
            .iter()
            .all(|row| row.iter().all(|&piece| piece != Piece::BlackKing))
        {
            Some(Player::White)
        } else if self
            .board
            .iter()
            .all(|row| row.iter().all(|&piece| piece != Piece::WhiteKing))
        {
            Some(Player::Black)
        } else if let Some(p) = self.resigned {
            Some(p.opponent())
        } else {
            None
        }
    }

    /// Resigns the game for one player.
    pub fn resign(&mut self, who: Player) {
        self.resigned = Some(who);
    }

    /// Returns true if the play was valid (and the game is updated), or false if it was invalid
    /// and the game state is unchanged. This requires mutable access for its entire duration to
    /// ensure exclusive access the entire time, so that no state change can happen between the
    /// move being validated and the move occurring.
    pub fn play_card(
        &mut self,
        row: u8,
        col: u8,
        who: Player,
        which: CardSlot,
        idx: u8,
    ) -> Option<String> {
        // First, ensure the square requested is on the board.
        if !Self::is_on_board(row as i8, col as i8) {
            debug!(
                "{:?} attempted to move r:{}, c:{} which is off board",
                who, row, col,
            );
            return None;
        }

        // Ensure the player has a piece on the selected square.
        if self.board[row as usize][col as usize].get_player() != Some(who) {
            debug!(
                "{:?} attempted to move r:{}, c:{} which does not belong to them",
                who, row, col,
            );
            return None;
        }

        // Ensure it's the correct player's turn.
        if self.next_turn != who {
            debug!("{:?} attempted to move when it wasn't their turn", who);
            return None;
        }

        // Ensure the target of the move is on the board.
        let (new_row, new_col) = if let Some(movement) = self.cards.get_move(who, which, idx) {
            let new_row = match who {
                Player::White => (row as i8) + movement.rows,
                Player::Black => (row as i8) - movement.rows,
            };
            let new_col = match who {
                Player::White => (col as i8) + movement.cols,
                Player::Black => (col as i8) - movement.cols,
            };
            if Self::is_on_board(new_row, new_col) {
                (new_row, new_col)
            } else {
                debug!(
                    "{:?} attempted to move r:{}, c:{} to r:{}, c:{} which is off board",
                    who, row, col, new_row, new_col,
                );
                return None;
            }
        } else {
            debug!("{:?} attempted to do a move which doesn't exist", who);
            return None;
        };

        // All good; play the card and move the piece.
        let card_name = self.cards.play(who, which);
        self.board[new_row as usize][new_col as usize] = self.board[row as usize][col as usize];
        self.board[row as usize][col as usize] = Piece::Empty;
        self.next_turn = who.opponent();

        Some(format!("{} makes a move using the {}", who, card_name))
    }

    fn is_on_board(row: i8, col: i8) -> bool {
        (row >= 0) && (row < 5) && (col >= 0) && (col < 5)
    }
}
