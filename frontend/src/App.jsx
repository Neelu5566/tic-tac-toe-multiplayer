import { useState, useEffect, useRef } from "react";
import client, { useSSL } from "./nakama";
import "./App.css";

const getDeviceId = () => {
  const key = "ttt_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
};

export default function App() {
  const [screen, setScreen] = useState("nickname"); // nickname | matchmaking | playing
  const [nickname, setNickname] = useState("");
  const [mode, setMode] = useState("classic"); // "classic" | "timed"
  const [session, setSession] = useState(null);
  const [matchId, setMatchId] = useState(null);

  // Game state (updated by server broadcasts)
  const [board, setBoard] = useState(Array(9).fill(""));
  const [turn, setTurn] = useState("X");
  const [winner, setWinner] = useState("");
  const [draw, setDraw] = useState(false);
  const [players, setPlayers] = useState({});   // userID -> symbol
  const [usernames, setUsernames] = useState({}); // userID -> name
  const [mySymbol, setMySymbol] = useState(null);
  const [timedMode, setTimedMode] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(30);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState([]);

  // Refs to avoid stale closures in socket callbacks
  const socketRef = useRef(null);
  const ticketRef = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => { sessionRef.current = session; }, [session]);

  // Re-fetch leaderboard when game ends
  useEffect(() => {
    if ((winner || draw) && sessionRef.current) {
      client.listLeaderboardRecords(sessionRef.current, "wins", [], 10)
        .then(lb => setLeaderboard(lb.records || []))
        .catch(() => {});
    }
  }, [winner, draw]);

  const startMatchmaking = async () => {
    const name = nickname.trim();
    if (!name) return;
    setScreen("matchmaking");

    try {
      // Authenticate with a persistent device ID
      const sess = await client.authenticateDevice(getDeviceId(), true, name);
      setSession(sess);
      sessionRef.current = sess;

      // Open realtime socket — must pass useSSL or it defaults to false
      const sock = client.createSocket(useSSL);
      await sock.connect(sess, true);
      socketRef.current = sock;

      // Handle game state broadcasts from the server
      sock.onmatchdata = (data) => {
        const game = JSON.parse(new TextDecoder().decode(data.data));
        setBoard(game.board);
        setTurn(game.turn);
        setWinner(game.winner || "");
        setDraw(!!game.draw);
        setPlayers(game.players || {});
        setUsernames(game.usernames || {});
        setMySymbol(game.players?.[sess.user_id] || null);
        setTimedMode(!!game.timedMode);
        setTimeRemaining(game.timeRemaining ?? 30);
        setScreen("playing");
      };

      // When matchmaker pairs 2 players, join the authoritative match
      sock.onmatchmakermatched = async (matched) => {
        try {
          // Use match_id for authoritative matches, token for relayed
          const m = matched.match_id
            ? await sock.joinMatch(matched.match_id)
            : await sock.joinMatch(undefined, matched.token);
          setMatchId(m.match_id);
        } catch (err) {
          console.error("joinMatch failed:", err);
        }
      };

      // Enter the matchmaker queue (need exactly 2 players)
      // Pass mode as numeric property; server validates both players share same mode
      const modeValue = mode === "timed" ? 1 : 0;
      const ticket = await sock.addMatchmaker("*", 2, 2, {}, { mode: modeValue });
      ticketRef.current = ticket.ticket;
    } catch (err) {
      console.error("Matchmaking error:", err);
      setScreen("nickname");
    }
  };

  const makeMove = (index) => {
    const sock = socketRef.current;
    if (!sock || board[index] || winner || draw) return;
    if (mySymbol !== turn) return; // enforce turn client-side too
    sock.sendMatchState(matchId, 1, JSON.stringify({ index }));
  };

  const playAgain = () => {
    const sock = socketRef.current;
    if (sock && matchId) {
      sock.sendMatchState(matchId, 2, JSON.stringify({}));
    }
  };

  const backToMenu = async () => {
    const sock = socketRef.current;
    try {
      if (sock && matchId) {
        await sock.leaveMatch(matchId);
      } else if (sock && ticketRef.current) {
        await sock.removeMatchmaker(ticketRef.current);
      }
      if (sock) sock.disconnect(true);
    } catch (_) {}

    socketRef.current = null;
    ticketRef.current = null;
    setSession(null);
    setMatchId(null);
    setBoard(Array(9).fill(""));
    setTurn("X");
    setWinner("");
    setDraw(false);
    setPlayers({});
    setUsernames({});
    setMySymbol(null);
    setTimedMode(false);
    setTimeRemaining(30);
    setLeaderboard([]);
    setScreen("nickname");
  };

  // ── Screens ──────────────────────────────────────────────────────────────────

  if (screen === "nickname") {
    return (
      <div className="screen center">
        <div className="card">
          <h1 className="logo">Tic Tac Toe</h1>
          <h2 className="card-title">Who are you?</h2>
          <input
            className="input"
            type="text"
            placeholder="Nickname"
            value={nickname}
            maxLength={20}
            onChange={e => setNickname(e.target.value)}
            onKeyDown={e => e.key === "Enter" && startMatchmaking()}
          />
          <div className="mode-toggle">
            <button
              className={`mode-btn ${mode === "classic" ? "active" : ""}`}
              onClick={() => setMode("classic")}>
              Classic
            </button>
            <button
              className={`mode-btn ${mode === "timed" ? "active" : ""}`}
              onClick={() => setMode("timed")}>
              Timed (30s)
            </button>
          </div>
          <button className="btn primary" onClick={startMatchmaking} disabled={!nickname.trim()}>
            Find Match
          </button>
        </div>
      </div>
    );
  }

  if (screen === "matchmaking") {
    return (
      <div className="screen center">
        <div className="card">
          <h1 className="logo">Tic Tac Toe</h1>
          <p className="card-title">Finding a random player...</p>
          <p className="hint">It usually takes 30 seconds</p>
          <div className="spinner" />
          <button className="btn secondary" onClick={backToMenu}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Playing screen ────────────────────────────────────────────────────────────
  const uid = session?.user_id;
  const opponentId = uid ? Object.keys(players).find(id => id !== uid) : null;
  const myName = uid ? (usernames[uid] || nickname) : nickname;
  const opponentName = opponentId ? (usernames[opponentId] || "Opponent") : "Waiting...";
  const opponentSymbol = opponentId ? players[opponentId] : "?";
  const gameOver = winner !== "" || draw;
  const isMyTurn = mySymbol === turn && !gameOver;

  return (
    <div className="screen">
      {/* Player header */}
      <div className="player-bar">
        <div className={`player-info ${mySymbol === turn && !gameOver ? "active" : ""}`}>
          <span className="symbol-badge">{mySymbol}</span>
          <span className="player-name">{myName}<br /><small>you</small></span>
        </div>
        <div className="turn-status">
          {gameOver
            ? (winner ? (winner === mySymbol ? "You Win!" : "You Lose") : "Draw!")
            : (isMyTurn ? "Your Turn" : "Their Turn")}
          {timedMode && !gameOver && (
            <div className={`timer ${timeRemaining <= 10 ? "urgent" : ""}`}>
              {timeRemaining}s
            </div>
          )}
        </div>
        <div className={`player-info right ${opponentSymbol === turn && !gameOver ? "active" : ""}`}>
          <span className="player-name">{opponentName}</span>
          <span className="symbol-badge">{opponentSymbol}</span>
        </div>
      </div>

      {/* Board */}
      <div className="board">
        {board.map((cell, i) => (
          <div
            key={i}
            className={`cell ${cell} ${!cell && isMyTurn ? "clickable" : ""}`}
            onClick={() => makeMove(i)}
          >
            {cell}
          </div>
        ))}
      </div>

      {/* Game-over overlay */}
      {gameOver && (
        <div className="overlay">
          <div className="result-card">
            <h2 className="result-title">
              {winner
                ? (winner === mySymbol ? "Winner! 🎉" : "Game Over")
                : "Draw! 🤝"}
            </h2>
            {winner === mySymbol && <p className="result-pts">+100 pts</p>}

            <div className="result-buttons">
              <button className="btn primary" onClick={playAgain}>Play Again</button>
              <button className="btn secondary" onClick={backToMenu}>Menu</button>
            </div>

            {leaderboard.length > 0 && (
              <div className="leaderboard">
                <h3 className="lb-title">Leaderboard</h3>
                <div className="lb-header lb-row">
                  <span>#</span>
                  <span>Player</span>
                  <span>Wins</span>
                </div>
                {leaderboard.map((r, i) => (
                  <div key={r.owner_id} className={`lb-row ${r.owner_id === uid ? "me" : ""}`}>
                    <span>{i + 1}</span>
                    <span>{r.username}</span>
                    <span>{r.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
