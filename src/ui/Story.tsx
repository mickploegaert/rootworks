import { useEffect, useState } from 'react';
import type { Game, GameEvents, StoryView } from '../game/Game.ts';
import { Petals } from './Blossom.tsx';

/** Five blossoms, one per bloom stage the Heart Tree has reached. */
export function BloomMeter({ bloom, of = 5 }: { bloom: number; of?: number }) {
  return (
    <span className="bloom-meter" aria-label={`Heart Tree: ${bloom} of ${of} bloom stages`}>
      {Array.from({ length: of }, (_, k) => <i key={k} className={k < bloom ? 'on' : ''} />)}
    </span>
  );
}

/** The board's Valley tab: the current chapter's letter, its goals, and how far the Heart Tree has woken. */
export function StoryTab({ story }: { story: StoryView }) {
  return (
    <div className="story">
      <div className="story-head">
        <span className="label">{story.eternal ? 'Eternal Spring' : `Chapter ${story.chapter + 1} of ${story.chapters}`}</span>
        <BloomMeter bloom={story.bloom} of={story.chapters} />
      </div>
      <h3>{story.title}</h3>
      <p className="story-letter">“{story.letter}” <span className="muted">· {story.from}</span></p>
      {story.goals.map((g) => (
        <div key={g.text} className={`commission ${g.value >= g.target ? 'done' : ''}`}>
          <div className="row"><span>{g.text}</span><b>{g.value >= g.target ? 'Done' : `${g.value}/${g.target}`}</b></div>
          <div className="bar"><div style={{ width: `${(g.value / g.target) * 100}%` }} /></div>
        </div>
      ))}
      {story.open && <p className="muted story-hint">The Heart Tree stands west of the yard. Offer gifts by program: <code>go_to("heart")</code> then <code>put()</code>.</p>}
    </div>
  );
}

/** When a chapter ends: the closing words, a photo of the Heart Tree in its new bloom, and the next letter. */
export function ChapterLetter({ game }: { game: Game }) {
  const [moment, setMoment] = useState<GameEvents['story'] | null>(null);
  useEffect(() => game.events.on('story', setMoment), [game]);
  if (!moment) return null;
  const { done, next, image, bloom } = moment;
  return (
    <div className="pause-veil" role="dialog" aria-modal="true" aria-label={`Chapter complete: ${done.title}`}>
      <section className="panel chapter-letter">
        <Petals trigger={bloom} count={24} />
        <span className="label">Chapter complete · +{done.sparks} Sparks</span>
        <h2>{done.title}</h2>
        {image && <img src={image} alt="The Heart Tree in its new bloom" />}
        <BloomMeter bloom={bloom} />
        <p className="story-letter">“{done.text}” <span className="muted">· {done.from}</span></p>
        {next && (
          <div className="chapter-next">
            <span className="label">Next · {next.title}</span>
            <p className="story-letter">“{next.letter}” <span className="muted">· {next.from}</span></p>
          </div>
        )}
        <button type="button" className="btn-primary" autoFocus onClick={() => setMoment(null)}>{next ? 'Onward' : 'Celebrate'}</button>
      </section>
    </div>
  );
}
