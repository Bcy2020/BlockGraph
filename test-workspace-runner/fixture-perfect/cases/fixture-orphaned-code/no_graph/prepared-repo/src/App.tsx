import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LoginForm } from './features/auth/LoginForm';
import { DiscussionList } from './features/discussions/DiscussionList';
import { TeamList } from './features/teams/TeamList';
import { UserProfile } from './features/users/UserProfile';
import { PATHS } from './config/paths';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path={PATHS.login} element={<LoginForm />} />
        <Route path={PATHS.discussions} element={<DiscussionList />} />
        <Route path={PATHS.teams} element={<TeamList />} />
        <Route path={PATHS.user(':id')} element={<UserProfile userId="" />} />
      </Routes>
    </BrowserRouter>
  );
}
