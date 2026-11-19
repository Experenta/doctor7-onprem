import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/format.js';
import { SendIcon } from './icons.jsx';

const MAX_BODY_BYTES = 2000;

const CLOSE_MESSAGES = {
  1001: 'The server is restarting. Reconnect in a moment.',
  1009: 'The chat closed because a message was too large. Reconnect to continue.',
  4001: 'This appointment is closed, so the chat has ended.',
  4002: 'Your session ended. Sign in again to use the chat.',
  4003: 'You no longer have access to this chat.',
};
const DEFAULT_CLOSE = 'The chat could not stay connected. Check that the appointment is still scheduled, then reconnect.';

const ERROR_MESSAGES = {
  invalid_message: 'The message was not accepted. Write some text and send it again.',
  message_too_large: 'The message is too long. Shorten it and send it again.',
  server_error: 'The server could not process the message. Send it again.',
};

function socketUrl(appointmentId) {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/ws?appointment=${encodeURIComponent(appointmentId)}`;
}

export default function ChatPanel({ appointmentId, userId }) {
  const [connection, setConnection] = useState('connecting'); // connecting | open | closed
  const [messages, setMessages] = useState([]);
  const [notice, setNotice] = useState('');
  const [closedCode, setClosedCode] = useState(null);
  const [draft, setDraft] = useState('');
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    let active = true;
    setConnection('connecting');
    setNotice('');
    const socket = new WebSocket(socketUrl(appointmentId));
    socketRef.current = socket;

    socket.onopen = () => {
      if (active) setConnection('open');
    };
    socket.onmessage = (event) => {
      if (!active) return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame.type === 'history' && Array.isArray(frame.items)) {
        setMessages(frame.items);
      } else if (frame.type === 'message' && frame.message) {
        setMessages((current) =>
          current.some((item) => item.id === frame.message.id) ? current : [...current, frame.message],
        );
      } else if (frame.type === 'error' && frame.error) {
        setNotice(ERROR_MESSAGES[frame.error.code] || 'The chat reported a problem. Try again.');
      }
    };
    socket.onclose = (event) => {
      if (!active) return;
      setConnection('closed');
      setClosedCode(event.code);
    };

    return () => {
      active = false;
      socket.close();
    };
  }, [appointmentId, attempt]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  function send(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) {
      setNotice('Write a message before sending.');
      return;
    }
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      setNotice('The message is too long. Keep it under 2000 bytes and send it again.');
      return;
    }
    setNotice('');
    socketRef.current.send(JSON.stringify({ type: 'message', body }));
    setDraft('');
  }

  const canReconnect = connection === 'closed' && closedCode !== 4001;
  const statusText = {
    connecting: 'Connecting to the chat.',
    open: 'Connected.',
    closed: CLOSE_MESSAGES[closedCode] || DEFAULT_CLOSE,
  }[connection];

  return (
    <section className="panel" aria-labelledby="chat-title">
      <h2 id="chat-title">Chat</h2>
      <p className="muted" role="status">
        {statusText}
      </p>

      {messages.length === 0 && connection === 'open' && (
        <p>No messages yet. Write the first message below.</p>
      )}

      <ol className="chat-log" role="log" aria-live="polite" aria-label="Chat messages" ref={logRef}>
        {messages.map((message) => {
          const own = message.senderId === userId;
          return (
            <li key={message.id} className={own ? 'chat-item chat-item-own' : 'chat-item'}>
              <span className="chat-meta">
                {own ? 'You' : 'Other participant'}, {formatTime(message.sentAt)}
              </span>
              {message.body}
            </li>
          );
        })}
      </ol>

      {notice && (
        <div className="alert" role="alert">
          <p>{notice}</p>
        </div>
      )}

      {canReconnect && (
        <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
          Reconnect to chat
        </button>
      )}

      <form className="chat-form" onSubmit={send}>
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <input
          id="chat-message"
          className="input"
          type="text"
          autoComplete="off"
          placeholder="Write a message"
          value={draft}
          disabled={connection !== 'open'}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={connection !== 'open'}>
          <SendIcon />
          Send message
        </button>
      </form>
    </section>
  );
}
