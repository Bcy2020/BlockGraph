/**
 * Fixture: ParentForm component that renders LoginForm.
 * Used to test renders edge detection in scanner.
 */
import React from "react";
import { LoginForm } from "./LoginForm";

export function ParentForm() {
  return (
    <div>
      <h1>Welcome</h1>
      <LoginForm />
    </div>
  );
}
