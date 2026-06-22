import React, { useState } from 'react';
import { addComment } from './commentService';
import { Button } from '../../components/ui/Button';

interface CommentFormProps {
  discussionId: string;
  onCommentAdded: () => void;
}

export function CommentForm({ discussionId, onCommentAdded }: CommentFormProps) {
  const [text, setText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addComment(discussionId, text);
    setText('');
    onCommentAdded();
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={text} onChange={e => setText(e.target.value)} />
      <Button type="submit">Add Comment</Button>
    </form>
  );
}
