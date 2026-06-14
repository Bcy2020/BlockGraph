import React, { useEffect, useState } from 'react';
import { fetchDiscussions } from './discussionService';
import type { Discussion } from '../../types/discussion';

export function DiscussionList() {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);

  useEffect(() => {
    fetchDiscussions().then(setDiscussions);
  }, []);

  return (
    <ul>
      {discussions.map(d => (
        <li key={d.id}>{d.title}</li>
      ))}
    </ul>
  );
}
