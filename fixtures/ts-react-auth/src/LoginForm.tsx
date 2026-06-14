/**
 * Fixture: LoginForm component with onSubmit event handler.
 * Used by scanner fixture test (PRD §13.2).
 */
import React, { useState } from "react";
import { login } from "./authService";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    login(username, password);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Login</button>
    </form>
  );
}
