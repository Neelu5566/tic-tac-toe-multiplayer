package main

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/heroiclabs/nakama-common/runtime"
)

// ─── Game logic ────────────────────────────────────────────────────────────────

var winLines = [][]int{
	{0, 1, 2}, {3, 4, 5}, {6, 7, 8},
	{0, 3, 6}, {1, 4, 7}, {2, 5, 8},
	{0, 4, 8}, {2, 4, 6},
}

func checkWinner(board [9]string) string {
	for _, p := range winLines {
		if board[p[0]] != "" && board[p[0]] == board[p[1]] && board[p[1]] == board[p[2]] {
			return board[p[0]]
		}
	}
	return ""
}

func isDraw(board [9]string) bool {
	for _, cell := range board {
		if cell == "" {
			return false
		}
	}
	return true
}

// ─── Match state ───────────────────────────────────────────────────────────────

type MatchState struct {
	board     [9]string
	turn      string            // "X" or "O"
	winner    string            // "X", "O", or ""
	draw      bool
	symbols   map[string]string // userID -> "X" | "O"
	usernames map[string]string // userID -> display name
	timedMode bool
	timeLimit int64             // seconds per turn (30)
	turnTick  int64             // tick when current turn started
}

// ─── Broadcast ─────────────────────────────────────────────────────────────────

type StateMsg struct {
	Board         [9]string         `json:"board"`
	Turn          string            `json:"turn"`
	Winner        string            `json:"winner"`
	Draw          bool              `json:"draw"`
	Players       map[string]string `json:"players"`
	Usernames     map[string]string `json:"usernames"`
	TimedMode     bool              `json:"timedMode"`
	TimeRemaining int64             `json:"timeRemaining"`
}

func broadcastState(s *MatchState, tick int64, dispatcher runtime.MatchDispatcher) {
	tr := int64(0)
	if s.timedMode && s.winner == "" && !s.draw && s.turnTick > 0 {
		tr = s.timeLimit - (tick - s.turnTick)
		if tr < 0 {
			tr = 0
		}
	}
	msg := StateMsg{
		Board:         s.board,
		Turn:          s.turn,
		Winner:        s.winner,
		Draw:          s.draw,
		Players:       s.symbols,
		Usernames:     s.usernames,
		TimedMode:     s.timedMode,
		TimeRemaining: tr,
	}
	data, _ := json.Marshal(msg)
	_ = dispatcher.BroadcastMessage(1, data, nil, nil, true)
}

// ─── Match handlers ────────────────────────────────────────────────────────────

func (m *MatchState) MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	timed := false
	if v, ok := params["timed"]; ok {
		if b, ok := v.(bool); ok {
			timed = b
		}
	}
	return &MatchState{
		turn:      "X",
		symbols:   make(map[string]string),
		usernames: make(map[string]string),
		timedMode: timed,
		timeLimit: 30,
	}, 1, "waiting"
}

func (m *MatchState) MatchJoinAttempt(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s := state.(*MatchState)
	if len(s.symbols) >= 2 {
		return state, false, "match is full"
	}
	return state, true, ""
}

func (m *MatchState) MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*MatchState)
	for _, p := range presences {
		uid := p.GetUserId()
		if _, ok := s.symbols[uid]; !ok {
			if len(s.symbols) == 0 {
				s.symbols[uid] = "X"
			} else {
				s.symbols[uid] = "O"
			}
			s.usernames[uid] = p.GetUsername()
		}
	}
	label := "waiting"
	if len(s.symbols) == 2 {
		label = "playing"
		s.turnTick = tick // start the first turn timer
	}
	_ = dispatcher.MatchLabelUpdate(label)
	broadcastState(s, tick, dispatcher)
	return s
}

func (m *MatchState) MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*MatchState)
	for _, p := range presences {
		delete(s.symbols, p.GetUserId())
		delete(s.usernames, p.GetUserId())
	}
	if len(s.symbols) == 0 {
		return nil // terminate the match
	}
	_ = dispatcher.MatchLabelUpdate("waiting")
	broadcastState(s, tick, dispatcher)
	return s
}

func (m *MatchState) MatchLoop(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s := state.(*MatchState)

	// Need both players before processing moves
	if len(s.symbols) < 2 {
		return s
	}

	// Timer forfeit check
	if s.timedMode && s.winner == "" && !s.draw && s.turnTick > 0 {
		if tick-s.turnTick >= s.timeLimit {
			for uid2, sym := range s.symbols {
				if sym != s.turn {
					s.winner = sym
					_, _ = nk.LeaderboardRecordWrite(ctx, "wins", uid2, s.usernames[uid2], 1, 0, nil, nil)
				} else {
					_, _ = nk.LeaderboardRecordWrite(ctx, "wins", uid2, s.usernames[uid2], 0, 0, nil, nil)
				}
			}
		}
	}

	for _, msg := range messages {
		uid := msg.GetUserId()
		symbol, ok := s.symbols[uid]
		if !ok {
			continue
		}

		switch msg.GetOpCode() {
		case 1: // make a move
			if s.winner != "" || s.draw || symbol != s.turn {
				continue
			}
			var data struct {
				Index int `json:"index"`
			}
			if err := json.Unmarshal(msg.GetData(), &data); err != nil {
				continue
			}
			idx := data.Index
			if idx < 0 || idx > 8 || s.board[idx] != "" {
				continue
			}
			s.board[idx] = symbol
			s.winner = checkWinner(s.board)
			if s.winner == "" {
				s.draw = isDraw(s.board)
			}
			if s.winner == "" && !s.draw {
				if s.turn == "X" {
					s.turn = "O"
				} else {
					s.turn = "X"
				}
				s.turnTick = tick // reset timer for next turn
			}
			// Record win on leaderboard when game ends
			if s.winner != "" {
				for uid2, sym := range s.symbols {
					score := int64(0)
					if sym == s.winner {
						score = 1
					}
					_, _ = nk.LeaderboardRecordWrite(ctx, "wins", uid2, s.usernames[uid2], score, 0, nil, nil)
				}
			}

		case 2: // reset / play again
			if s.winner == "" && !s.draw {
				continue
			}
			s.board = [9]string{}
			s.turn = "X"
			s.winner = ""
			s.draw = false
			s.turnTick = tick
		}
	}

	// Always broadcast every tick — ensures clients receive state even if they
	// missed the MatchJoin broadcast (timing race on connect).
	broadcastState(s, tick, dispatcher)
	return s
}

func (m *MatchState) MatchTerminate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
	return nil
}

func (m *MatchState) MatchSignal(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string) {
	return state, ""
}

// ─── InitModule ────────────────────────────────────────────────────────────────

func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	// Persistent leaderboard tracking total wins (desc, increment operator)
	if err := nk.LeaderboardCreate(ctx, "wins", false, "desc", "incr", "", nil, true); err != nil {
		logger.Warn("LeaderboardCreate: %v", err)
	}

	// Register the authoritative match handler
	if err := initializer.RegisterMatch("tic-tac-toe", func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
		return &MatchState{}, nil
	}); err != nil {
		return err
	}

	// Matchmaker: when 2 players are paired, create an authoritative match for them
	if err := initializer.RegisterMatchmakerMatched(func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error) {
		if len(entries) < 2 {
			return "", nil
		}
		getMode := func(e runtime.MatchmakerEntry) float64 {
			if props := e.GetProperties(); props != nil {
				if v, ok := props["mode"]; ok {
					if f, ok := v.(float64); ok {
						return f
					}
				}
			}
			return 0
		}
		mode0 := getMode(entries[0])
		mode1 := getMode(entries[1])
		if mode0 != mode1 {
			// Different modes — reject this pairing, players stay in queue
			return "", nil
		}
		timed := mode0 == 1
		return nk.MatchCreate(ctx, "tic-tac-toe", map[string]interface{}{"timed": timed})
	}); err != nil {
		return err
	}

	logger.Info("Tic-Tac-Toe module loaded")
	return nil
}