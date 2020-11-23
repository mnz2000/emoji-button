import { EmojiRecord, EmojiButtonOptions, RecentEmoji, EmojiData } from './types';

const LOCAL_STORAGE_KEY = 'emojiPicker.recent';

export function load(emojiData): Array<RecentEmoji> {
  const recentJson = localStorage.getItem(LOCAL_STORAGE_KEY);
  var recents = recentJson ? JSON.parse(recentJson) : [];
  if (emojiData) {
	  recents = recents.map(recent => emojiData.emoji.find(e=>e.emoji===recent.emoji));
  }
  return recents.filter(recent => recent && !!recent.emoji);
}

export function save(
  emoji: EmojiRecord | RecentEmoji,
  options: EmojiButtonOptions
): void {
  const recents = load(null);

  const recent = {
    emoji: emoji.emoji,
    custom: emoji.custom
  };

  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify(
      [
        recent,
        ...recents.filter((r: RecentEmoji) => !!r.emoji && r.emoji !== recent.emoji)
      ].slice(0, options.recentsCount)
    )
  );
}
