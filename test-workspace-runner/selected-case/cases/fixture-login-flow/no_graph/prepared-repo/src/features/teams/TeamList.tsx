import React, { useEffect, useState } from 'react';
import { fetchTeams } from './teamService';
import type { Team } from '../../types/team';

export function TeamList() {
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    fetchTeams().then(setTeams);
  }, []);

  return (
    <ul>
      {teams.map(t => (
        <li key={t.id}>{t.name}</li>
      ))}
    </ul>
  );
}
